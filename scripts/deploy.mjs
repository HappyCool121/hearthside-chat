import { execFileSync } from 'node:child_process';
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
if (git('remote', 'get-url', 'origin') !== 'https://github.com/HappyCool121/hearthside-chat.git') throw new Error('Unexpected repository.');
if (git('status', '--porcelain')) throw new Error('Deploy only from a clean checkout.');
const sha = git('rev-parse', 'HEAD');
if (sha !== git('rev-parse', 'origin/main')) throw new Error('Fetch and use the merged origin/main commit.');
execFileSync('npm', ['run', 'build'], { stdio: 'inherit' });
execFileSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'pages', 'deploy', 'dist', '--project-name', 'hearthside-chat', '--branch', 'main', '--commit-hash', sha, '--commit-dirty=false'], { stdio: 'inherit' });
