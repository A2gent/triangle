set shell := ["zsh", "-cu"]

default:
  @just --list

install:
  npm install

setup: install
  if [ ! -f .env ]; then cp .env.example .env; fi
  @echo "Created .env from .env.example if missing. Update TRIANGLE_SQUARE_API_KEY (prefer sqi_...) and optional TRIANGLE_DEFAULT_RECIPIENT_AGENT_ID."

backend:
  set -a; source .env; set +a; npm run dev:backend

build:
  npm run build

typecheck:
  npm run typecheck
