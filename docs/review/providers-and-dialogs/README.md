# Providers and dialog review captures

After captures from the isolated Linux ARM64 desktop fixture, based on main
50e98b7 (Code60 0.3.2). Providers are fake ACP processes; no credentials or real
user data appear. Before captures were not recorded.

- [Providers gallery and matching sidebar](providers.png)
- [Provider setup dialog with balanced padding and 10px corners](provider-dialog.png)

Validation used `npm run test:desktop:container` with the provider management
scenario. The local QA report retains exact commands, process/persistence
assertions and theme/narrow-window coverage. These images establish appearance,
not live-provider connectivity or browser extension compatibility.
