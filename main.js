const { app, BrowserWindow, Menu, Tray, clipboard, ipcMain, dialog } = require('electron');
const path = require('path');
const server = require('./server');
const os = require('os');
const fs = require('fs');
const fetch = require('node-fetch');

let mainWindow;
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

    // For true portability in 'portable' mode, use PORTABLE_EXECUTABLE_DIR
    const ROOT_PATH = process.env.PORTABLE_EXECUTABLE_DIR ||
        (IS_PACKAGED ? path.dirname(process.execPath) : __dirname);

    const THEMES_DIR = path.join(ROOT_PATH, 'Theme');
    const SAVE_DIR = path.join(ROOT_PATH, 'Save');
    const AUTOEXEC_DIR = path.join(ROOT_PATH, 'autoexec');

    // Standardized Brand Icons
    const BRAND_ICON_PNG = path.join(ROOT_PATH, 'TeleCode-icon.png');
    const BRAND_ICON_ICO = path.join(ROOT_PATH, 'TeleCode-icon.ico');
    const FALLBACK_ICON = path.join(ROOT_PATH, 'front.png');

    const CONFIG_PATH = path.join(ROOT_PATH, 'config.json');
    const GITHUB_BASE = "https://raw.githubusercontent.com/7yd7/TeleCode/test/Theme";

    // --- Initialization Functions ---
    async function ensureStructure() {
        if (!fs.existsSync(THEMES_DIR)) fs.mkdirSync(THEMES_DIR, { recursive: true });
        if (!fs.existsSync(SAVE_DIR)) fs.mkdirSync(SAVE_DIR, { recursive: true });
        if (!fs.existsSync(AUTOEXEC_DIR)) fs.mkdirSync(AUTOEXEC_DIR, { recursive: true });

        // Copy from resources if available (First run / Update)
        try {
            const resourceThemeDir = path.join(process.resourcesPath, 'Theme');
            if (fs.existsSync(resourceThemeDir)) {
                // Only copy if themes folder is empty
                if (getAvailableThemes().length === 0) {
                    fs.cpSync(resourceThemeDir, THEMES_DIR, { recursive: true, force: false });
                }
            }

            // ALWAYS try to update from GitHub (Auto-Update)
            await updateThemeFromGitHub();

            // Copy Icons to ROOT_PATH if missing
            const icons = ['TeleCode-icon.png', 'TeleCode-icon.ico', 'front.png'];
            for (const icon of icons) {
                const resourceIcon = path.join(process.resourcesPath, icon);
                const destIcon = path.join(ROOT_PATH, icon);
                if (fs.existsSync(resourceIcon) && !fs.existsSync(destIcon)) {
                    fs.copyFileSync(resourceIcon, destIcon);
                }
            }
        } catch (e) {
            console.error("Setup error:", e);
        }
    }

    // Get all available themes dynamically (any folder with index.html)
    function getAvailableThemes() {
        if (!fs.existsSync(THEMES_DIR)) return [];
        return fs.readdirSync(THEMES_DIR, { withFileTypes: true })
            .filter(dirent => dirent.isDirectory())
            .filter(dirent => fs.existsSync(path.join(THEMES_DIR, dirent.name, 'index.html')))
            .map(dirent => dirent.name);
    }

    // Force Update Theme from GitHub (Auto-Updater)
    async function updateThemeFromGitHub() {
        const defaultThemePath = path.join(THEMES_DIR, 'TeleCode-UI');
        if (!fs.existsSync(defaultThemePath)) fs.mkdirSync(defaultThemePath, { recursive: true });

        const indexPath = path.join(defaultThemePath, 'index.html');

        try {
            console.log("Checking for UI updates...");
            // Use a cache-busting parameter
            const url = `${GITHUB_BASE}/TeleCode-UI/index.html?t=${Date.now()}`;
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 5000); // 5s timeout

            const res = await fetch(url, { signal: controller.signal });
            clearTimeout(timeout);

            if (res.ok) {
                const newContent = await res.text();
                // Simple check for valid content
                if (newContent.includes('<!DOCTYPE html>') || newContent.includes('<html')) {
                    fs.writeFileSync(indexPath, newContent);
                    console.log("UI Updated successfully from GitHub");
                }
            }
        } catch (e) {
            console.log("Update check failed (Offline?):", e.message);
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
            if (!fs.existsSync(currentThemePath)) {
                const defaultDir = path.join(THEMES_DIR, 'Default');
                if (!fs.existsSync(defaultDir)) fs.mkdirSync(defaultDir, { recursive: true });
                fs.writeFileSync(currentThemePath, `<!DOCTYPE html><html><body style="background:#111;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;"><div><h1>Syncing...</h1><p>Please wait and restart app.</p></div></body></html>`);
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

        // Always use TeleCode brand icons
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

        // Ensure tray icon also stays consistent
        if (tray) {
            const trayIcon = fs.existsSync(BRAND_ICON_PNG) ? BRAND_ICON_PNG : (fs.existsSync(FALLBACK_ICON) ? FALLBACK_ICON : undefined);
            if (trayIcon) tray.setImage(trayIcon);
        }
    }

    function createTray() {
        // Use brand PNG for Tray
        const finalTrayIcon = fs.existsSync(BRAND_ICON_PNG) ? BRAND_ICON_PNG :
            (fs.existsSync(FALLBACK_ICON) ? FALLBACK_ICON :
                (IS_PACKAGED ? path.join(process.resourcesPath, 'front.png') : path.join(__dirname, 'front.png')));

        tray = new Tray(finalTrayIcon);
        const ip = getLocalIP();
        const loaderScript = `loadstring(game:HttpGet("http://${ip}:3000/loader"))()`;

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
                { label: `Path: ${ROOT_PATH.substring(0, 30)}...`, enabled: false },
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
                { label: 'Open File Location', click: () => shell.openPath(ROOT_PATH) },
                { label: 'Copy Loader Script', click: () => clipboard.writeText(loaderScript) },
                { type: 'separator' },
                { label: 'Exit', click: () => { app.isQuitting = true; app.quit(); } }
            ]);
            tray.setContextMenu(contextMenu);
        }

        tray.setToolTip('TeleCode Executor');
        updateMenu();
        tray.on('double-click', () => { if (mainWindow) mainWindow.show(); else createWindow(currentThemePath); });
        if (fs.existsSync(THEMES_DIR)) fs.watch(THEMES_DIR, () => updateMenu());
    }

    // --- IPC Handlers ---
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

    ipcMain.handle('save-script', async (event, { name, content }) => {
        const filePath = path.join(SAVE_DIR, name);
        fs.writeFileSync(filePath, content);
        return true;
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

    ipcMain.on('refresh-ui', () => {
        if (mainWindow) mainWindow.reload();
    });

    ipcMain.on('set-always-on-top', (event, value) => {
        if (mainWindow) mainWindow.setAlwaysOnTop(value);
    });

    ipcMain.on('window-resize', (event, action) => {
        if (!mainWindow) return;
        const [width, height] = mainWindow.getSize();
        const step = 50;
        if (action === 'increase') {
            mainWindow.setSize(width + step, height + step);
        } else if (action === 'decrease') {
            mainWindow.setSize(Math.max(400, width - step), Math.max(300, height - step));
        } else if (action === 'reset') {
            mainWindow.setSize(800, 500);
        }
    });

    // Get autoexec scripts
    function getAutoExecScripts() {
        if (!fs.existsSync(AUTOEXEC_DIR)) return [];
        return fs.readdirSync(AUTOEXEC_DIR)
            .filter(f => f.endsWith('.lua') || f.endsWith('.txt') || f.endsWith('.luau'))
            .map(f => fs.readFileSync(path.join(AUTOEXEC_DIR, f), 'utf8'));
    }

    // Export for server to use
    global.getAutoExecScripts = getAutoExecScripts;

    // --- App Lifecycle ---
    app.on('ready', async () => {
        await ensureStructure();
        validateTheme();
        server.listen(3000, '0.0.0.0');
        createWindow(currentThemePath);
        createTray();
    });

    app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
