# Security Policy

## Supported versions

Only the latest released version of Code60 receives security fixes. Upgrade to
the latest release before reporting an issue when practical.

## Reporting a vulnerability

Report suspected vulnerabilities privately to **[SECURITY CONTACT EMAIL]**.
Do not open a public issue or publish exploit details before coordinated disclosure.

Include the affected version, platform, steps to reproduce, and the potential
impact. Provide a minimal example when possible, without credentials, private
prompts, or other sensitive data.

We aim to acknowledge reports within five business days. After reviewing the
report, we will share our assessment and coordinate fixes and disclosure with
you. This is a response target, not a guarantee of a fix date.

## Automated security reviews

The **Security review** workflow (`.github/workflows/security-review.yml`) runs
on every pull request, every push to `main`, Mondays at 07:23 UTC, and manual
dispatch. Scheduled scans also catch newly published advisories when the code
has not changed.

- **CodeQL** scans JavaScript and TypeScript with the `security-extended` query
  suite, without building or running the application. Findings include locations,
  explanations, and remediation guidance in **Security > Code scanning** and
  the pull request's code scanning check. The `codeql-security-report` artifact
  retains the full SARIF assessment, including scans with no findings.
- **Dependency security report** audits the lockfile, including development
  dependencies, without installing packages or running lifecycle scripts. The
  Actions job summary contains the readable npm report with affected packages,
  advisory links, dependency paths, and available fixes. The
  `npm-security-report` artifact retains the full text report.

Reports are retained for 30 days, including when a scan fails. High or critical
dependency advisories fail the dependency job; lower-severity advisories remain
visible in the report. Registry errors also fail the job and are not treated as
clean scans. CodeQL findings are reviewed in code scanning; successful query
execution alone does not mean that there are no findings. Review and triage
findings before merging. Automation supplements, but does not replace, manual
security review.

To reproduce the dependency assessment locally:

```sh
npm audit --package-lock-only --ignore-scripts --include=dev --audit-level=high
```
