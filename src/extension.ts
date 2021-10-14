// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import { exec, spawn } from 'child_process';
import { existsSync } from 'fs';
import { unlink } from 'fs/promises';
import * as vscode from 'vscode';
import { ViewColumn } from 'vscode';

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
let channel: vscode.OutputChannel | undefined;

// get tmp folder 
let tmpPath = process.env['TEMP'] || process.env['TMP'];
let tmpBuildOut = `${tmpPath}\\view_assembly.s`;

export function activate(context: vscode.ExtensionContext) {
	
	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	channel = vscode.window.createOutputChannel('view-assembly');
	channel.appendLine("view-assembly is now active.");
	
	let arch = 'x64';

	// The command has been defined in the package.json file`
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	let disposable = vscode.commands.registerCommand('view-assembly.viewAssembly', async () => {
		// The code you place here will be executed every time your command is executed
	
		// get currently active text document
		if (vscode.window.activeTextEditor === undefined) {
			vscode.window.showErrorMessage("No C/C++ file currently selected.");
			return;
		}
		
		const fullFileName = vscode.window.activeTextEditor.document.fileName;
		const lastBackslash = fullFileName.lastIndexOf('\\');
		const path = fullFileName.slice(0, lastBackslash);
		const fileName = fullFileName.slice(lastBackslash + 1);
		channel?.appendLine(`path: ${path}`);
		channel?.appendLine(`fileName: ${fileName}`);

		// set up x64 environment and compile using "cl.exe /FaC:<name>.s <name.c>"
		let terminal = vscode.window.createTerminal('view-assembly', 'cmd');
		terminal.show();
		terminal.sendText(`vcvarsall ${arch} && cl.exe /nologo /FAc /c -EHsc /Fa"${tmpBuildOut}" "${path}\\${fileName}" && exit(0)\n`);
		channel?.appendLine(`${terminal.exitStatus}`);

		while (terminal.exitStatus === undefined) {
			await new Promise(r => setTimeout(r, 100));
		}

		if (terminal.exitStatus.code === undefined || terminal.exitStatus.code < 0) {
			vscode.window.showErrorMessage(`Compilation failed. Exit status: ${terminal.exitStatus.code}.`);
		} else {
			// Open editor with assembly result.
			let doc = await vscode.workspace.openTextDocument(`${tmpBuildOut}`);
			let editor = vscode.window.showTextDocument(doc.uri, {
				viewColumn: ViewColumn.Beside,
				preview: true,
				preserveFocus: true,
			});
		}
		terminal.dispose();
	});

	context.subscriptions.push(disposable);
}

// this method is called when your extension is deactivated
export async function deactivate() {

	// delete all temporary files.
	if (existsSync(`${tmpBuildOut}`)) {
		await unlink(`${tmpBuildOut}`);
	}


	// dispose output channel.
	channel?.dispose();
}
