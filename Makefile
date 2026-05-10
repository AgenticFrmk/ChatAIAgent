.PHONY: build up run logs down clean open help

COMPOSE = docker compose

help:
	@echo "Usage: make <target>"
	@echo ""
	@echo "  build   Build all images"
	@echo "  up      Start all services (detached)"
	@echo "  run     Build + start all services, then open the browser"
	@echo "  logs    Tail logs for all services"
	@echo "  down    Stop and remove containers"
	@echo "  clean   Stop containers and delete volumes (wipes DBs + RSA keys)"
	@echo "  open    Open the ChatAIAgent UI in the browser"

build: .env
	$(COMPOSE) build

up: .env
	$(COMPOSE) up -d

run: .env
	$(COMPOSE) up --build -d
	@echo ""
	@echo "Stack is starting. UI will be available at http://localhost:3001"
	@echo "Run 'make logs' to follow startup, 'make open' when ready."

open:
	open http://localhost:3001

logs:
	$(COMPOSE) logs -f

down:
	$(COMPOSE) down

clean:
	$(COMPOSE) down -v

.env:
	@if [ ! -f .env ]; then \
		cp .env.example .env; \
		echo "Created .env from .env.example — fill in ANTHROPIC_API_KEY and GITHUB_TOKEN before running."; \
		exit 1; \
	fi
