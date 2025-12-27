const { app, BrowserWindow, Menu, Tray, clipboard, ipcMain, dialog } = require('electron');
const path = require('path');
const server = require('./server'); // Import the server module
const os = require('os');
const fs = require('fs');
const fetch = require('node-fetch');
const AdmZip = require('adm-zip');

let mainWindow;
let splashWindow;
let tray;

// --- Single Instance Lock ---
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
    app.quit();
} else {
    app.on('second-instance', (event, commandLine, workingDirectory) => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.show();
            mainWindow.focus();
        }
    });

    // --- Path Configuration ---
    const { shell } = require('electron');
    const IS_PACKAGED = app.isPackaged;

    const ROOT_PATH = process.env.PORTABLE_EXECUTABLE_DIR ||
        (IS_PACKAGED ? path.dirname(process.execPath) : __dirname);

    const THEMES_DIR = path.join(ROOT_PATH, 'Theme');
    const SAVE_DIR = path.join(ROOT_PATH, 'Save');
    const AUTOEXEC_DIR = path.join(ROOT_PATH, 'autoexec');
    const DATA_DIR = path.join(ROOT_PATH, 'Data'); // New Data folder for config

    // Asset Paths: Prefer resourcesPath when packaged to keep root clean
    const RESOURCES_PATH = IS_PACKAGED ? process.resourcesPath : __dirname;
    const BRAND_ICON_PNG = path.join(RESOURCES_PATH, 'TeleCode-icon.png');
    const BRAND_ICON_ICO = path.join(RESOURCES_PATH, 'TeleCode-icon.ico');
    const FALLBACK_ICON = path.join(RESOURCES_PATH, 'front.png');

    const CONFIG_PATH = path.join(DATA_DIR, 'config.json');

    // --- Boot / Update Logic ---
    async function startApp() {
        createSplashWindow();
        await performUpdate();
    }

    function createSplashWindow() {
        splashWindow = new BrowserWindow({
            width: 400,
            height: 300,
            frame: false,
            transparent: true,
            center: true,
            icon: fs.existsSync(BRAND_ICON_ICO) ? BRAND_ICON_ICO : undefined,
            webPreferences: { nodeIntegration: true, contextIsolation: false }
        });
        splashWindow.loadFile('splash.html');
    }

    async function performUpdate() {
        // Skip update if requested via env
        if (process.env.SKIP_UPDATE) {
            launchMain();
            return;
        }

        const repoUrl = 'https://github.com/7yd7/TeleCode/archive/refs/heads/test.zip';
        const zipPath = path.join(os.tmpdir(), 'telecode_update.zip');

        try {
            if (splashWindow) splashWindow.webContents.send('status', 'Connecting to GitHub...');

            const res = await fetch(repoUrl);
            if (!res.ok) throw new Error('Update server unreachable');

            if (splashWindow) splashWindow.webContents.send('status', 'Downloading update...');

            const fileStream = fs.createWriteStream(zipPath);
            await new Promise((resolve, reject) => {
                res.body.pipe(fileStream);
                res.body.on('error', reject);
                fileStream.on('finish', resolve);
            });

            if (splashWindow) splashWindow.webContents.send('status', 'Installing updates...');

            const zip = new AdmZip(zipPath);
            const zipEntries = zip.getEntries();
            const rootFolder = zipEntries[0].entryName.split('/')[0];

            zipEntries.forEach((entry) => {
                if (entry.isDirectory) return;

                const relativePath = entry.entryName.substring(rootFolder.length + 1);
                if (!relativePath) return;

                // --- WHITELIST FILTER ---
                // Only extract Theme, Save, and autoexec folders.
                // Ignore main.js, server.js, package.json, and root images.
                const shouldExtract =
                    relativePath.startsWith('Theme/') ||
                    relativePath.startsWith('Save/') ||
                    relativePath.startsWith('autoexec/');

                if (!shouldExtract) return;

                const targetPath = path.join(ROOT_PATH, relativePath);
                const targetDir = path.dirname(targetPath);

                if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
                fs.writeFileSync(targetPath, entry.getData());
            });

            // Cleanup
            try { fs.unlinkSync(zipPath); } catch (e) { }

            launchMain();

        } catch (e) {
            console.error(e);
            if (splashWindow) splashWindow.webContents.send('error', 'Update Failed: ' + e.message);
            setTimeout(launchMain, 2000);
        }
    }

    function launchMain() {
        if (splashWindow && !splashWindow.isDestroyed()) splashWindow.close();
        ensureStructure();
        validateTheme();

        try {
            server.listen(3000, '0.0.0.0', () => {
                console.log('Server running on 0.0.0.0:3000');
            });
        } catch (e) { console.error("Server error:", e); }

        createWindow(currentThemePath);
        createTray();
    }

    ipcMain.on('retry-update', () => performUpdate());
    ipcMain.on('skip-update', () => launchMain());

    // --- Original Initialization ---
    function ensureStructure() {
        if (!fs.existsSync(THEMES_DIR)) fs.mkdirSync(THEMES_DIR, { recursive: true });
        if (!fs.existsSync(SAVE_DIR)) fs.mkdirSync(SAVE_DIR, { recursive: true });
        if (!fs.existsSync(AUTOEXEC_DIR)) fs.mkdirSync(AUTOEXEC_DIR, { recursive: true });
        if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

        // Copy from resources (built-in themes) to mutable usage dir if empty
        if (IS_PACKAGED) {
            const bundledThemeDir = path.join(process.resourcesPath, 'Theme');
            if (fs.existsSync(bundledThemeDir)) {
                if (fs.readdirSync(THEMES_DIR).length === 0) {
                    try {
                        fs.cpSync(bundledThemeDir, THEMES_DIR, { recursive: true });
                    } catch (e) {
                        console.error("Failed to copy bundled themes:", e);
                    }
                }
            }
        }
    }

    function loadConfig() {
        try {
            if (fs.existsSync(CONFIG_PATH)) return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
        } catch (e) { }
        return { lastTheme: 'TeleCode-UI' };
    }

    function saveConfig(config) {
        try { fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2)); } catch (e) { }
    }

    let config = loadConfig();
    let currentThemePath = path.join(THEMES_DIR, config.lastTheme, 'index.html');

    function validateTheme() {
        if (!fs.existsSync(currentThemePath)) {
            currentThemePath = path.join(THEMES_DIR, 'Default', 'index.html');
            if (fs.existsSync(path.join(THEMES_DIR, 'TeleCode-UI', 'index.html'))) {
                currentThemePath = path.join(THEMES_DIR, 'TeleCode-UI', 'index.html');
            }

            if (!fs.existsSync(currentThemePath)) {
                const emergencyPath = path.join(THEMES_DIR, 'recovery.html');
                fs.writeFileSync(emergencyPath, '<html><body style="background:#222;color:#fff"><h1>Recovery Mode</h1><p>Theme files missing. Restarting might invoke updater.</p></body></html>');
                currentThemePath = emergencyPath;
            }
        }
    }

    function getLocalIP() {
        const interfaces = os.networkInterfaces();
        for (const name of Object.keys(interfaces)) {
            for (const iface of interfaces[name]) {
                if (iface.family === 'IPv4' && !iface.internal) return iface.address;
            }
        }
        return '127.0.0.1';
    }

    function createWindow(htmlPath) {
        if (mainWindow) mainWindow.close();

        let finalIcon = fs.existsSync(BRAND_ICON_ICO) ? BRAND_ICON_ICO :
            (fs.existsSync(BRAND_ICON_PNG) ? BRAND_ICON_PNG : (fs.existsSync(FALLBACK_ICON) ? FALLBACK_ICON : undefined));

        mainWindow = new BrowserWindow({
            width: 800,
            height: 500,
            frame: false,
            transparent: true,
            icon: finalIcon,
            webPreferences: {
                nodeIntegration: true,
                contextIsolation: false
            }
        });

        mainWindow.loadFile(htmlPath);
        mainWindow.on('closed', () => { mainWindow = null; });
        mainWindow.on('close', (event) => {
            if (!app.isQuitting) {
                event.preventDefault();
                mainWindow.hide();
            }
        });

        if (tray) {
            const trayIcon = fs.existsSync(BRAND_ICON_PNG) ? BRAND_ICON_PNG : (fs.existsSync(FALLBACK_ICON) ? FALLBACK_ICON : undefined);
            if (trayIcon) tray.setImage(trayIcon);
        }
    }

    function createTray() {
        const finalTrayIcon = fs.existsSync(BRAND_ICON_PNG) ? BRAND_ICON_PNG :
            (fs.existsSync(FALLBACK_ICON) ? FALLBACK_ICON : undefined);

        tray = new Tray(finalTrayIcon);
        const ip = getLocalIP();
        const advancedLoader = `-- TeleCode Master Loader
getgenv().TeleCodeIP = "http://${ip}:3000"
loadstring(game:HttpGet(getgenv().TeleCodeIP .. "/loader"))()`;

        function updateMenu() {
            let themeItems = [];
            if (fs.existsSync(THEMES_DIR)) {
                const dirs = fs.readdirSync(THEMES_DIR, { withFileTypes: true })
                    .filter(dirent => dirent.isDirectory())
                    .map(dirent => dirent.name);

                themeItems = dirs.map(dirName => {
                    const indexPath = path.join(THEMES_DIR, dirName, 'index.html');
                    if (fs.existsSync(indexPath)) {
                        return {
                            label: dirName,
                            type: 'radio',
                            checked: currentThemePath === indexPath,
                            click: () => {
                                currentThemePath = indexPath;
                                config.lastTheme = dirName;
                                saveConfig(config);
                                createWindow(indexPath);
                            }
                        };
                    }
                    return null;
                }).filter(item => item !== null);
            }

            const contextMenu = Menu.buildFromTemplate([
                { label: 'TeleCode Executor', enabled: false },
                { type: 'separator' },
                {
                    label: 'Show UI', click: () => {
                        if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
                        else createWindow(currentThemePath);
                    }
                },
                {
                    label: 'Refresh UI', click: () => {
                        if (mainWindow) mainWindow.reload();
                    }
                },
                { label: 'Themes', submenu: themeItems },
                { label: 'Copy Loader Script', click: () => clipboard.writeText(advancedLoader) },
                { type: 'separator' },
                { label: 'Exit', click: () => { app.isQuitting = true; app.quit(); } }
            ]);
            tray.setContextMenu(contextMenu);
        }

        tray.setToolTip('TeleCode Executor');
        updateMenu();
        tray.on('double-click', () => { if (mainWindow) mainWindow.show(); else createWindow(currentThemePath); });
    }

    // --- IPC & Handlers ---
    ipcMain.on('window-hide', () => { if (mainWindow) mainWindow.hide(); });
    ipcMain.on('window-minimize', () => { if (mainWindow) mainWindow.minimize(); });

    ipcMain.handle('get-scripts', async () => {
        if (!fs.existsSync(SAVE_DIR)) return [];
        return fs.readdirSync(SAVE_DIR).filter(f => f.endsWith('.lua') || f.endsWith('.txt') || f.endsWith('.luau'));
    });

    ipcMain.handle('read-script', async (event, filename) => {
        const filePath = path.join(SAVE_DIR, filename);
        if (fs.existsSync(filePath)) return fs.readFileSync(filePath, 'utf8');
        return '';
    });

    ipcMain.handle('get-autoexec', async () => {
        if (!fs.existsSync(AUTOEXEC_DIR)) return [];
        return fs.readdirSync(AUTOEXEC_DIR).filter(f => f.endsWith('.lua') || f.endsWith('.txt') || f.endsWith('.luau'));
    });

    ipcMain.handle('read-autoexec', async (event, filename) => {
        const filePath = path.join(AUTOEXEC_DIR, filename);
        if (fs.existsSync(filePath)) return fs.readFileSync(filePath, 'utf8');
        return '';
    });

    ipcMain.handle('save-autoexec', async (event, { name, content }) => {
        const filePath = path.join(AUTOEXEC_DIR, name);
        fs.writeFileSync(filePath, content);
        return true;
    });

    ipcMain.handle('save-script', async (event, { name, content }) => {
        const filePath = path.join(SAVE_DIR, name);
        fs.writeFileSync(filePath, content);
        return true;
    });

    ipcMain.on('rename-file', (event, { type, oldName, newName }) => {
        const dir = type === 'autoexec' ? AUTOEXEC_DIR : SAVE_DIR;
        const oldPath = path.join(dir, oldName);
        const newPath = path.join(dir, newName);
        if (fs.existsSync(oldPath)) {
            fs.renameSync(oldPath, newPath);
        }
    });

    ipcMain.handle('delete-file', async (event, { type, name }) => {
        const dir = type === 'autoexec' ? AUTOEXEC_DIR : SAVE_DIR;
        const filePath = path.join(dir, name);
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            return true;
        }
        return false;
    });

    ipcMain.handle('open-file-dialog', async () => {
        const result = await dialog.showOpenDialog(mainWindow, {
            properties: ['openFile'],
            filters: [{ name: 'Scripts', extensions: ['lua', 'txt', 'luau'] }]
        });
        if (!result.canceled && result.filePaths.length > 0) {
            return {
                name: path.basename(result.filePaths[0]),
                content: fs.readFileSync(result.filePaths[0], 'utf8')
            };
        }
        return null;
    });

    ipcMain.on('set-always-on-top', (event, value) => {
        if (mainWindow) mainWindow.setAlwaysOnTop(value);
    });

    global.getAutoExecScripts = function () {
        if (!fs.existsSync(AUTOEXEC_DIR)) return [];
        return fs.readdirSync(AUTOEXEC_DIR)
            .filter(f => f.endsWith('.lua') || f.endsWith('.txt') || f.endsWith('.luau'))
            .map(f => fs.readFileSync(path.join(AUTOEXEC_DIR, f), 'utf8'));
    };

    app.on('ready', startApp);
    app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
