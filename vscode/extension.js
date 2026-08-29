/**
 * F.O.R.G.E. in the editor.
 *
 * DELIBERATELY THIN. This extension shells out to the same CLI everything else uses and
 * renders the result — it re-implements nothing. That is the whole design constraint: a
 * second implementation of routing or the audit would eventually disagree with the first,
 * and then "what does F.O.R.G.E. say" would depend on where you asked.
 *
 * So every command here is a terminal invocation or a webview pointed at the local Console.
 * If the CLI is not installed the extension says so plainly rather than degrading into a
 * worse version of it.
 *
 * Zero dependencies, like the rest of the repo. `vscode` is the only import and that is
 * supplied by the host.
 */

const vscode = require('vscode');
const cp = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

/** Where the CLI lives: setting, then $FORGE_HOME, then the conventional checkout. */
const forgeHome = () => {
  const configured = vscode.workspace.getConfiguration('forge').get('home');
  for (const candidate of [configured, process.env.FORGE_HOME, path.join(os.homedir(), 'F.O.R.G.E')]) {
    if (candidate && fs.existsSync(path.join(candidate, 'scripts', 'forge.mjs'))) return candidate;
  }
  return null;
};

const cwd = () => {
  const folders = vscode.workspace.workspaceFolders;
  return folders && folders.length ? folders[0].uri.fsPath : os.homedir();
};

/** Run a forge command and hand back stdout. Rejects with stderr, which is where the CLI explains itself. */
const run = (args) =>
  new Promise((resolve, reject) => {
    const home = forgeHome();
    if (!home) {
      reject(new Error('F.O.R.G.E. was not found. Set forge.home in settings, or $FORGE_HOME.'));
      return;
    }
    cp.execFile(
      process.execPath,
      [path.join(home, 'scripts', 'forge.mjs'), ...args],
      { cwd: cwd(), maxBuffer: 8 * 1024 * 1024 },
      (err, stdout, stderr) => {
        // A non-zero exit is often the ANSWER here, not a failure: `doctor` exits 1 on a
        // violation and `checklist --strict` exits 1 on a pending item. Both still produce
        // the output the reader wants, so stdout wins whenever there is any.
        if (stdout && stdout.trim()) resolve(stdout);
        else if (err) reject(new Error(stderr || err.message));
        else resolve(stdout);
      },
    );
  });

const output = vscode.window.createOutputChannel('F.O.R.G.E.');
const show = (text) => {
  output.clear();
  output.appendLine(text);
  output.show(true);
};

const runAndShow = async (args, title) => {
  try {
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title }, async () => {
      show(await run(args));
    });
  } catch (e) {
    vscode.window.showErrorMessage(`F.O.R.G.E.: ${e.message}`);
  }
};

function activate(context) {
  const reg = (id, fn) => context.subscriptions.push(vscode.commands.registerCommand(id, fn));

  reg('forge.doctor', () => runAndShow(['doctor'], 'Constitutional audit…'));
  reg('forge.lint', () => runAndShow(['lint'], 'Linting this workspace…'));
  reg('forge.context', () => runAndShow(['context'], 'Reading what this workspace taught…'));
  reg('forge.verify', () => runAndShow(['verify', '--all'], 'Spot-checking evidence claims…'));

  reg('forge.plan', async () => {
    const request = await vscode.window.showInputBox({
      prompt: 'What should the organization plan?',
      placeHolder: 'add rate limiting to the auth endpoint',
    });
    if (!request) return;
    await runAndShow(['plan', request, '--with-policy'], 'Composing the Campaign Vector…');
  });

  reg('forge.checklist', async () => {
    const campaign = await vscode.window.showInputBox({ prompt: 'Campaign id', placeHolder: 'C-0001' });
    if (!campaign) return;
    await runAndShow(['checklist', campaign], 'Reading the checklist…');
  });

  reg('forge.deck', async () => {
    const port = vscode.workspace.getConfiguration('forge').get('port') || 7717;
    const home = forgeHome();
    if (!home) {
      vscode.window.showErrorMessage('F.O.R.G.E. was not found. Set forge.home in settings, or $FORGE_HOME.');
      return;
    }
    // Started detached and left running: the Console is a place you keep open, and tying its
    // lifetime to one command invocation would close it the moment you looked away.
    const child = cp.spawn(process.execPath, [path.join(home, 'scripts', 'forge.mjs'), 'deck', '--port', String(port)], {
      cwd: cwd(), detached: true, stdio: 'ignore',
    });
    child.unref();
    const panel = vscode.window.createWebviewPanel('forgeConsole', 'F.O.R.G.E.', vscode.ViewColumn.One, { enableScripts: true, retainContextWhenHidden: true });
    // Loopback only, and said so in the frame — the Console reads a private workspace and
    // there is no authentication because there is meant to be no remote.
    panel.webview.html = `<!doctype html><html><head><meta charset="utf-8"><style>
      html,body,iframe{margin:0;padding:0;border:0;width:100%;height:100vh;display:block;background:transparent}
    </style></head><body><iframe src="http://127.0.0.1:${port}/console.html"></iframe></body></html>`;
  });

  // Opt-in, and off by default: a check that fires on every save is a check people turn off,
  // and then it is not running when it matters.
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (!vscode.workspace.getConfiguration('forge').get('lintOnSave')) return;
      if (!/(registry|charter)[/\\].*\.yaml$/.test(doc.fileName)) return;
      runAndShow(['doctor'], 'Registry changed — re-auditing…');
    }),
  );
}

function deactivate() {}

module.exports = { activate, deactivate, forgeHome };
