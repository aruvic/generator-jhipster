# OAS/JDL Regression Harness

This folder contains the ad hoc regression harness used to validate generated
applications from JDL artifacts while using the matching OpenAPI YAML files as
the REST contract.

The scripts expect this workspace layout by default:

- `generator-jhipster/`
- `oas-to-jdl/artifacts/`
- generated apps as siblings of `generator-jhipster/`

The paths can be overridden with environment variables.

## Generate and Compile

```bash
npm run build
test/oas-regression/generate_compile.sh
```

This first refreshes JDL files from every OpenAPI YAML file in the artifact
folder, then discovers matching `*.yaml`/`*.jdl` pairs and regenerates one app
per pair. Add a new YAML file to the artifact folder and the harness will pick
up its generated JDL automatically.

## Runtime Smoke Tests

```bash
test/oas-regression/runtime_loop.sh
```

The runtime loop discovers the same artifact pairs, resets PostgreSQL for each
generated app, starts Spring Boot on port `8081`, authenticates as `admin/admin`,
runs YAML-driven smoke tests, and runs the deep TMF683
`POST /api/partyInteraction` plus PostgreSQL verification when that artifact is
present.

By default, runtime evidence and generated request payloads are written to
`/tmp/generator-jhipster-regression`. Set `OUTPUT_DIR` to change that location.

Useful overrides:

```bash
WORKSPACE_ROOT=/path/to/workspace
ARTIFACT_ROOT=/path/to/artifacts
OAS_TO_JDL_JAR=/path/to/oas-to-jdl.jar
SKIP_OAS_TO_JDL=true
REGRESSION_APP_ROOT=/path/to/generated/apps
PORT=8081
OUTPUT_DIR=/tmp/generator-jhipster-regression
TMF_PAYLOAD=/path/to/party-interaction-full.json
ARTIFACT_INCLUDE=TMF683,oas3v1
ARTIFACT_EXCLUDE=DCSA_EBL
```
