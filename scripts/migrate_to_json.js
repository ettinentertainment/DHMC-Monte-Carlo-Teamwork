const fs = require('fs');
const vm = require('vm');
const path = require('path');

// Helper to find data in sandbox or sandbox.window
function findData(sandbox, keys) {
    for (const key of keys) {
        if (sandbox[key]) return sandbox[key];
        if (sandbox.window && sandbox.window[key]) return sandbox.window[key];
    }
    return null;
}

const MAPPINGS = [
    {
        src: 'libraries/item_library.js',
        dest: 'data/library_items.json',
        extract: (sandbox) => {
            // Priority 1: Check for the wrapper object 'item_library'
            const wrapper = findData(sandbox, ['item_library']);
            if (wrapper && wrapper.WEAPON_LIBRARY) {
                console.log('   -> Unpacking item_library wrapper...');
                return {
                    weapons: wrapper.WEAPON_LIBRARY,
                    armor: wrapper.ARMOR_LIBRARY || {}
                };
            }
            // Priority 2: Check for global standalone variables
            return {
                weapons: findData(sandbox, ['WEAPON_LIBRARY']) || {},
                armor: findData(sandbox, ['ARMOR_LIBRARY']) || {}
            };
        }
    },
    {
        src: 'libraries/class_features.js',
        dest: 'data/library_classes.json',
        extract: (sandbox) => findData(sandbox, ['CLASS_FEATURES', 'class_features'])
    },
    {
        src: 'libraries/domain-card-library.js',
        dest: 'data/library_domains.json',
        extract: (sandbox) => findData(sandbox, ['DOMAIN_CARD_LIBRARY', 'domain_card_library'])
    },
    {
        src: 'libraries/srd_adversaries_library.js',
        dest: 'data/library_adversaries.json',
        extract: (sandbox) => findData(sandbox, ['ADVERSARY_LIBRARY', 'SRD_ADVERSARIES', 'srd_adversaries_library'])
    },
    {
        src: 'libraries/conditions_library.js',
        dest: 'data/library_conditions.json',
        extract: (sandbox) => findData(sandbox, ['CONDITION_LIBRARY', 'condition_library'])
    },
    {
        src: 'libraries/environments_library.js',
        dest: 'data/library_environments.json',
        extract: (sandbox) => findData(sandbox, ['ENVIRONMENTS_LIBRARY', 'environments_library'])
    },
    {
        src: 'libraries/ancestry_community_libraries.js',
        dest: 'data/library_origins.json',
        extract: (sandbox) => ({
            ancestries: findData(sandbox, ['ANCESTRY_LIBRARY']),
            communities: findData(sandbox, ['COMMUNITY_LIBRARY'])
        })
    }
];

// Ensure 'data' directory exists
const dataDir = path.join(__dirname, '../data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

console.log('Starting Robust JSON Migration...');

MAPPINGS.forEach(task => {
    const srcPath = path.join(__dirname, '../', task.src);
    const destPath = path.join(__dirname, '../', task.dest);

    if (!fs.existsSync(srcPath)) {
        console.warn(`[SKIP] Source not found: ${task.src}`);
        return;
    }

    try {
        const code = fs.readFileSync(srcPath, 'utf8');
        const sandbox = { 
            window: {}, 
            console: { log: () => {}, warn: () => {}, error: () => {} } // Silence library logs
        };
        vm.createContext(sandbox);
        vm.runInContext(code, sandbox);

        const data = task.extract(sandbox);

        // Validation: Did we get data?
        if (!data || (Object.keys(data).length === 0 && data.constructor === Object)) {
            console.error(`[FAIL] Could not extract data from ${task.src}`);
            console.error(`       Available keys in window: ${Object.keys(sandbox.window).join(', ')}`);
            console.error(`       Available keys in root: ${Object.keys(sandbox).filter(k => k !== 'window' && k !== 'console').join(', ')}`);
        } else {
            fs.writeFileSync(destPath, JSON.stringify(data, null, 2));
            console.log(`[OK] Converted ${task.src}`);
        }

    } catch (err) {
        console.error(`[ERROR] processing ${task.src}: ${err.message}`);
    }
});
console.log('Migration Complete.');