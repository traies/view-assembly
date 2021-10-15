// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import { assert } from 'console';
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

let terminal: vscode.Terminal;
let items: vscode.StatusBarItem[] = [];

function createCommandWithOptions (
	context: vscode.ExtensionContext,
	commandName: string, 
	options: string[], 
	defaultOption: string, 
	selectionTitle: string, 
	selectionPlaceholder: string,
	statusItemButton: (a: string) => string,
	updateOptionCallback: (a: string) => void) {
	let item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
	const showItem = (itemValue: string) => {
		item.text = statusItemButton(itemValue);
		item.show();
	};
	item.command = commandName;
	showItem(defaultOption);
	context.subscriptions.push(item);
	items.push(item);

	// create arch selection command
	context.subscriptions.push(vscode.commands.registerCommand(commandName, async () => {
		let selected = await vscode.window.showQuickPick(options, {
			canPickMany: false,
			title: selectionTitle,
			placeHolder: selectionPlaceholder,

		});
		if (selected !== undefined) {
			updateOptionCallback(selected);
			showItem(selected);
		}
	}));
}

export function activate(context: vscode.ExtensionContext) {
	
	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	channel = vscode.window.createOutputChannel('view-assembly');
	channel.appendLine("view-assembly is now active.");
	
	// add view-assembly status item to the bottom bar
	let viewAssemblyCommand = 'view-assembly.viewAssembly';
	let item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
	item.command = viewAssemblyCommand;
	item.text = 'view-assembly';
	item.show();
	context.subscriptions.push(item);
	items.push(item);

	// architecture options
	let archs = ['amd64', 'amd64_x86', 'amd64_arm', 'amd64_arm64'];
	let arch = vscode.workspace.getConfiguration('view-assembly').get<string>('defaultArchitecture');
	if (arch === undefined) {
		// eslint-disable-next-line no-throw-literal
		throw 'Error reading configuration file';
	}
	let selectArchitectureCommand = 'view-assembly.selectArchitecture';
	createCommandWithOptions(
		context,
		selectArchitectureCommand,
		archs,
		arch,
		'Select architecture for view-assembly.',
		'Example, amd64_arm means using x64 tools to build ARM32 binaries.',
		itemValue => `arch: ${itemValue}`,
		option => arch = option
	);

	// optimization options
	let optFlags = ['/Od', '/O1', '/O2'];
	let opt = vscode.workspace.getConfiguration('view-assembly').get<string>('defaultOptimization'); 
	if (opt === undefined) {
		// eslint-disable-next-line no-throw-literal
		throw 'Error reading configuration file';
	}
	let selectOptimizationCommand = 'view-assembly.selectOptimization';
	createCommandWithOptions(
		context,
		selectOptimizationCommand,
		optFlags,
		opt,
		'Select optimization flag for view-assembly.',
		'From MSDN, /Od disables optimizations, /O1 creates small code, /O2 creates fast code.',
		opt => `opt: ${opt}`,
		o => opt = o
	);

	// enable machine code
	let machineCodeFlagEnabled = ['Off', 'On'];
	let machineCodeSelection = vscode.workspace.getConfiguration('view-assembly').get<string>('defaultMachineCode');
	if (machineCodeSelection === undefined) {
		// eslint-disable-next-line no-throw-literal
		throw 'Error reading configuration file';
	}
	let machineCodeFlag = machineCodeSelection === 'On' ? 'c' : ''; 
	let selectMachineCodeCommand = 'view-assembly.selectMachineCode';

	createCommandWithOptions(
		context,
		selectMachineCodeCommand,
		machineCodeFlagEnabled,
		machineCodeSelection,
		'Toggle machine code',
		'Choose whether view-assembly displays machine code.',
		option => `machine code: ${option}`,
		option => {
			machineCodeFlag = option === "On" ? 'c' : ''; 
		}
	);

	// enable "run on save"
	let runOnSaveOptions = ['Off', 'On'];
	let runOnSaveSelection = vscode.workspace.getConfiguration('view-assembly').get<string>('defaultRunOnSave');
	if (runOnSaveSelection === undefined) {
		// eslint-disable-next-line no-throw-literal
		throw 'Error reading configuration file';
	}
	let runOnSave =  runOnSaveSelection === "On" ? true : false;; 

	let selectRunOnSaveCommand = 'view-assembly.selectRunOnSave';

	createCommandWithOptions(
		context,
		selectRunOnSaveCommand,
		runOnSaveOptions,
		'Off',
		'Toggle run on save',
		'Choose whether view-assembly runs when the file is saved.',
		option => `run on save: ${option}`,
		option => {
			runOnSave = option === "On" ? true : false; 
		}
	);

	// The command has been defined in the package.json file`
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	let disposable = vscode.commands.registerCommand(viewAssemblyCommand, async () => {
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
		terminal = vscode.window.createTerminal('view-assembly', 'cmd');
		terminal.show();
		terminal.sendText(`vcvarsall ${arch} && cl.exe /nologo ${opt} /FA${machineCodeFlag} /c /Fa"${tmpBuildOut}" -EHsc "${path}\\${fileName}" && exit(0)\n`);

		while (terminal.exitStatus === undefined) {
			await new Promise(r => setTimeout(r, 100));
		}

		if (terminal.exitStatus.code === undefined || terminal.exitStatus.code < 0) {
			vscode.window.showErrorMessage(`Compilation failed. Exit status: ${terminal.exitStatus.code}.`);
		} else {
			// Open editor with assembly result.
			let doc = await vscode.workspace.openTextDocument(`${tmpBuildOut}`, );
			
			// close editor, then reopen it (this forces a refresh of the file). Yes, it's a hack: https://stackoverflow.com/questions/44733028/how-to-close-textdocument-in-vs-code
			await vscode.window.showTextDocument(doc.uri, {
				viewColumn: ViewColumn.Beside,
				preview: false,
				preserveFocus: false,
			});
			vscode.commands.executeCommand('workbench.action.closeActiveEditor');
			
			await vscode.window.showTextDocument(doc.uri, {
				viewColumn: ViewColumn.Beside,
				preview: false,
				preserveFocus: true,
			});
		}
		terminal.dispose();
	});

	// Listen when the text editor changes, we only want to be active when a c/c++ file is open.
	vscode.window.onDidChangeActiveTextEditor(event => {
		if (event?.document.languageId === "c" || event?.document.languageId === "cpp") {
			items.forEach(i => i.show());
		} else {
			items.forEach(i => i.hide());
		}
	});

	// Listen when the current file is saved. If "run on save" is active and the current file is c/c++, we run.
	vscode.workspace.onDidSaveTextDocument(document => {
		if (runOnSave && document.languageId === "c" || document.languageId === "cpp") {
			vscode.commands.executeCommand(viewAssemblyCommand);
		} 
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
