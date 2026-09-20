.PHONY: help install dev build clean typecheck lint

help:
	@echo "Bad Faith Extension - Available Commands"
	@echo ""
	@echo "  make install       Install dependencies (npm)"
	@echo "  make dev           Watch build (rebuilds on file changes)"
	@echo "  make build         Build production bundle once"
	@echo "  make typecheck     Run TypeScript type checking"
	@echo "  make clean         Remove dist/ and node_modules/"
	@echo "  make clean-dist    Remove only dist/ directory"
	@echo "  make       Build the dev design harness in dev/"
	@echo ""

install:
	npm install

dev:
	npm run dev

build: typecheck
	npm run build

typecheck:
	npm run typecheck

clean: clean-dist
	rm -rf node_modules

clean-dist:
	rm -rf dist

# Helper target for CI/CD
ci: clean install build
