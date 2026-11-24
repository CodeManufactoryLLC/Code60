# Browser-Based UI

Draft

## Motivation

### Goal

Maximize execution speed: minimize the work between a feature idea and a working,
tested release.

### Delivery overhead

An Electron shell adds native process wiring, packaging, updates and
platform-specific testing to a product whose interface already uses React.
Removing that shell reduces the infrastructure maintained alongside features.

## Description

### UI and Gateway

Use a browser as Code60's only UI, backed by one local Node process that owns
application state, agents and scheduled jobs. React talks to the Gateway through
a narrow, authenticated loopback API. The application runs locally.

### Execution lifetime

Closing or refreshing the browser leaves approved work running. Stopping the
Gateway is a separate, explicit action. Approved Transmission workflows retain
their independent engine ownership and can continue after Gateway shutdown.

### Development and distribution

Use React Fast Refresh and headless browser journeys during development.
Distribute an npm package with manual updates.

## Tradeoffs

### Pros

- **Faster iteration:** browser tooling, hot reload and headless tests shorten
  the development loop.
- **Less release machinery:** removing Electron eliminates its shell, native
  packaging and automatic updater from routine maintenance.
- **Independent execution:** approved work continues when a browser page closes
  or refreshes.

### Cons

- **More user setup:** Node and npm are prerequisites. Gateway lifecycle and
  manual updates need clear instructions.
- **Less native integration:** native window effects, desktop installers and
  automatic updates are given up.
- **A local API to maintain:** sessions, origin checks, scoped file access and
  page-bound confirmations remain necessary.
- **More lifecycle concepts:** the UI must explain Gateway availability, control
  ownership and the different ways to stop work.
