# Third-party notices

Application code is licensed under MIT (see LICENSE).

`seccomp_profile.json` is copied from Microsoft Playwright's Docker support files:
https://github.com/microsoft/playwright/blob/v1.64.0/utils/docker/seccomp_profile.json

Playwright is Copyright (c) Microsoft Corporation and distributed under Apache License 2.0.
A copy of that license is included at [licenses/Apache-2.0.txt](licenses/Apache-2.0.txt).
The profile is based on Docker's default seccomp profile with user-namespace permissions
needed by Chromium, as described in https://playwright.dev/docs/docker.

The Docker base image and npm dependencies retain their own licenses and notices.
Playwright and playwright-core are installed from the lockfile; their license files
remain inside the installed packages in the container.
