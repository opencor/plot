import { GlobalRegistrator } from '@happy-dom/global-registrator';

// Make the DOM (as implemented by happy-dom) available to our tests (see bunfig.toml).

GlobalRegistrator.register();
