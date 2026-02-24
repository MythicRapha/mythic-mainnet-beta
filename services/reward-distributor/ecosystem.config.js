module.exports = {
  apps: [{
    name: 'mythic-reward-distributor',
    script: '/mnt/data/mythic-l2/services/reward-distributor/index.js',
    cwd: '/mnt/data/mythic-l2/services/reward-distributor',
    env: {
      RPC_URL: 'http://127.0.0.1:8899',
      DEPLOYER_KEY: '/mnt/data/mythic-l2/keys/deployer.json',
      INTERVAL_MS: '420000', // ~7 minutes
    },
    max_memory_restart: '200M',
    autorestart: true,
    watch: false,
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
  }],
};
