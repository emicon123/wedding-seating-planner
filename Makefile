# Cross-cutting targets. OpenAPI tooling per ADR-001 §5 (Redocly CLI, pinned, via npx).
REDOCLY := npx --yes @redocly/cli@2.57.0
OPENAPI_SRC := docs/openapi/openapi.yaml
OPENAPI_BUNDLE := docs/openapi.yaml
REDOCLY_CONFIG := docs/openapi/redocly.yaml

.PHONY: openapi openapi-bundle openapi-lint

## openapi: lint the source and regenerate the bundle (run after any contract change)
openapi: openapi-lint openapi-bundle

## openapi-lint: lint the OpenAPI 3.1 source tree
openapi-lint:
	$(REDOCLY) lint --config $(REDOCLY_CONFIG) $(OPENAPI_SRC)

## openapi-bundle: bundle docs/openapi/ into docs/openapi.yaml (generated — never edit by hand)
openapi-bundle:
	$(REDOCLY) bundle --config $(REDOCLY_CONFIG) $(OPENAPI_SRC) --output $(OPENAPI_BUNDLE)
	$(REDOCLY) lint --config $(REDOCLY_CONFIG) $(OPENAPI_BUNDLE)
