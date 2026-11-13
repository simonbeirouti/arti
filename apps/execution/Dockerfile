FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
RUN npm install --prefix /compiler typescript@7.0.2
COPY features/cloud-build/runner.mjs /runner.mjs
ENTRYPOINT ["sleep", "infinity"]
