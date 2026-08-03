module.exports = {
  apps: [{
    name: 'rentech-backend',
    script: 'dist/index.js',
    interpreter: 'node',
    restart_delay: 1000,
    max_restarts: 5,
    env: { NODE_ENV: 'production' },
    watch: false, // production only — dev uses tsx watch, not pm2
  }],
};
