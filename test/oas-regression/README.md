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
present. After smoke tests pass it resets PostgreSQL again, starts the generated
EvoMaster white-box driver, and runs EvoMaster against the generated API.

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
EVOMASTER_ENABLED=true
EVOMASTER_JAR=/home/aruvic/development/tools/evomaster/evomaster-6.0.0.jar
EVOMASTER_SECONDS_PER_API=600
EVOMASTER_CONTROLLER_PORT=40100
EVOMASTER_OUTPUT_FORMAT=JAVA_JUNIT_5
EVOMASTER_MINIMIZE_TIMEOUT_MINUTES=5
EVOMASTER_TCP_TIMEOUT_MS=10000
EVOMASTER_TEST_TIMEOUT=30
EVOMASTER_SECURITY=true
EVOMASTER_XSS=false
EVOMASTER_FAIL_ON_FAULTS=true
EVOMASTER_FAIL_ON_WRITER_WARNINGS=false
EVOMASTER_SKIP_FAILURE_SQL_IN_TEST_FILE=true
EVOMASTER_JAVA_OPTS="-Xms512m -Xmx4g"
```

EvoMaster evidence is stored under
`$OUTPUT_DIR/<artifact>/evomaster/`, including the generated tests, WFC report,
statistics CSV, driver log, EvoMaster log, `faults-summary.json`, and
`status.json`. `EVOMASTER_FAIL_ON_FAULTS` defaults to `true`; set it to `false`
only when collecting exploratory findings without failing the loop.
Generated-test writer warnings are counted separately in `status.json`. They
default to non-fatal because EvoMaster can skip unprintable SQL setup commands
while still producing the API fault report and generated tests; set
`EVOMASTER_FAIL_ON_WRITER_WARNINGS=true` when auditing EvoMaster output itself.

`EVOMASTER_XSS` defaults to `false` because these generated REST endpoints return
JSON and commonly echo persisted string fields. Enable it explicitly for APIs
that return browser-rendered HTML or other executable content.

The generated EvoMaster driver feeds EvoMaster a normalized copy of the source
OpenAPI document. It preserves the API operations while adapting tool/runtime
edges: path-level parameters are moved onto operations, discriminator `allOf`
subtypes are flattened for EvoMaster, and standard generated JHipster framework
responses such as empty 401/403/404 and `application/problem+json`
400/406/409/415 are added so schema oracles focus on generated server defects.
