import { createAddonManager } from '../src/addons.mjs';
import { dataDir } from '../src/config.mjs';

const help = 'Usage: node scripts/addons.mjs list | inspect PATH | install PATH --trust | enable ID --trust | disable ID | remove ID';
try {
  const args = process.argv.slice(2);
  if (!args.length || args.includes('--help') || args.includes('-h')) { console.log(help); }
  else {
    const [action, value, flag] = args;
    if (!['list', 'inspect', 'install', 'enable', 'disable', 'remove'].includes(action) || (action === 'list' ? args.length !== 1 : !value || args.length > (['install', 'enable'].includes(action) ? 3 : 2)) || (flag && flag !== '--trust')) throw new Error(help);
    const manager = createAddonManager({ dataDir });
    const result = action === 'list' ? await manager.list()
      : action === 'inspect' ? await manager.inspect(value)
        : action === 'install' ? await manager.install(value, { trust: flag === '--trust' })
          : await manager[action](value, { trust: flag === '--trust' });
    console.log(JSON.stringify(result, null, 2));
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
