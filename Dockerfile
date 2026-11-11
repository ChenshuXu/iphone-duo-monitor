FROM mcr.microsoft.com/playwright@sha256:06a9939e57531807f8d5fd76ce44b53165ffb7d7501d87ab10e285c20b1e971f
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY --chown=1000:1000 core.cjs browser.cjs server.cjs ./
COPY --chown=1000:1000 public ./public
RUN mkdir -p /data && chown 1000:1000 /data
USER 1000:1000
# Chromium reports TZ to Apple; keep it consistent with the en-US browser locale.
ENV HOME=/data/home TZ=America/Los_Angeles
CMD ["sh", "-c", "Xvfb :99 -screen 0 1440x1100x24 -nolisten tcp & export DISPLAY=:99; exec node server.cjs"]
