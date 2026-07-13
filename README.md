# Bowen Ferry  (bowen-lift-ferry)

 
## Install the dependencies
```bash
yarn
# or
npm install
```

### Start the app in development mode (hot-code reloading, error reporting, etc.)
```bash
quasar dev
```

### Lint the files
```bash
yarn lint
# or
npm run lint
```

### Format the files
```bash
yarn format
# or
npm run format
```

### Build the app for production
```bash
quasar build
```

### Customize the configuration
See [Configuring quasar.config.js](https://v2.quasar.dev/quasar-cli-webpack/quasar-config-js).

## Docs
- [Lineup timelapse & crosswalk classifier](docs/lineup-classifier.md) — how the
  5-minute lineup captures, "Full to Crosswalk" tagging, and the ML training
  pipeline work, including the dataset-export cron job
  (`scripts/cron-export-lineup-dataset.sh`) that must run at least every two weeks.
# ferry-view
