# Build image for the Linux job of .forgejo/workflows/release.yml: system packages, Rust, the npm cache and all
# Rust dependencies already compiled, so a run only compiles Notepad itself. Build and push it with
# scripts/ci-image.sh (on a machine with podman or docker); rebuild it when dependencies change a lot (it still
# works when they change, cargo just compiles the difference).
FROM docker.io/library/node:20-bookworm

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      build-essential curl wget file pkg-config perl python3 \
      libwebkit2gtk-4.1-dev libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev \
      libdbus-1-dev rpm xdg-utils \
 && rm -rf /var/lib/apt/lists/*

ENV RUSTUP_HOME=/usr/local/rustup CARGO_HOME=/usr/local/cargo PATH=/usr/local/cargo/bin:$PATH \
    CARGO_TARGET_DIR=/opt/notepad-target CARGO_TERM_COLOR=never
RUN curl -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal --no-modify-path

# npm cache: `npm ci` in the job then installs from disk.
COPY package.json package-lock.json /tmp/warm/
RUN cd /tmp/warm && npm ci --ignore-scripts && rm -rf /tmp/warm

# Compile every Rust dependency with the real Cargo.toml/Cargo.lock and a stand-in crate, then drop the stand-in.
COPY src-tauri/Cargo.toml src-tauri/Cargo.lock /tmp/deps/
RUN cd /tmp/deps \
 && mkdir src && echo 'fn main() {}' > src/main.rs && echo '' > src/lib.rs && echo 'fn main() {}' > build.rs \
 && cargo build --release --locked \
 && cargo clean --release -p notepad \
 && rm -rf /tmp/deps
