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

`generate_compile.sh` always performs the generated Java test-support compile
with the webapp profile disabled. Enable generated Angular validation explicitly
when the run should pay the Node dependency, production build, or focused
operation-form test cost:

```bash
ANGULAR_BUILD_ENABLED=true test/oas-regression/generate_compile.sh
ANGULAR_TEST_ENABLED=true test/oas-regression/generate_compile.sh
```

When Angular validation is enabled, the script runs `npm run webapp:prod` after
Java compile for builds and
`npm run webapp:test -- --test-path-pattern=openapi-operations|form-crud` for
focused OpenAPI UI tests. If `node_modules` is missing, it first runs
`npm install --no-audit --no-fund --offline`; override with
`ANGULAR_NPM_INSTALL=skip` to require preinstalled dependencies or
`ANGULAR_NPM_INSTALL=online` only in network-enabled CI. Use
`ANGULAR_BUILD_COMMAND`, `ANGULAR_TEST_COMMAND`, and `NPM_INSTALL_COMMAND` for
alternate package-manager commands. Each generation, Java compile, npm install,
Angular build, Angular test, and artifact total phase prints UTC timestamps and
duration seconds.

For full-matrix collection runs that should continue after artifact failures,
use:

```bash
test/oas-regression/full_matrix.sh
```

This wrapper runs the generator build, regenerates JDL once, then runs
generation/compile and runtime/EvoMaster per discovered artifact. It keeps going
after artifact-level failures, writes per-artifact logs under
`$OUTPUT_DIR/<artifact>/harness/`, and produces
`$OUTPUT_DIR/full-matrix-summary.json` plus a JUnit-style
`$OUTPUT_DIR/full-matrix-junit.xml`. Each phase status includes UTC start/end
timestamps and wall-clock duration seconds so slow runs can be compared across
cycles. The summary also includes an `evomaster` aggregate with total declared,
exercised, and 2xx-covered endpoint counts, wall-time-to-budget ratio, sweep
duration/gain totals, and per-artifact coverage summaries.

Set `MAVEN_OFFLINE=true` and `DOCKER_COMPOSE_UP_ARGS="--pull never"` to force a
local-only run against cached Maven artifacts and cached Docker images. The
full-matrix wrapper defaults to those local-only settings. Full-matrix process
timeouts default to `FULL_MATRIX_BUILD_TIMEOUT_SECONDS=1800`,
`FULL_MATRIX_OAS_TO_JDL_TIMEOUT_SECONDS=900`,
`FULL_MATRIX_GENERATE_COMPILE_TIMEOUT_SECONDS=7200`,
`FULL_MATRIX_RUNTIME_TIMEOUT_SECONDS=7200`, and
`FULL_MATRIX_TIMEOUT_KILL_AFTER_SECONDS=60`.

## Runtime Smoke Tests

```bash
test/oas-regression/runtime_loop.sh
```

The runtime loop discovers the same artifact pairs, resets PostgreSQL for each
generated app, starts Spring Boot on port `8081`, authenticates as `admin/admin`,
runs YAML-driven smoke tests, runs a local Playwright Form CRUD GUI regression,
and runs the deep TMF683
`POST /api/partyInteraction` plus PostgreSQL verification when that artifact is
present. After smoke tests pass it resets PostgreSQL again, starts the generated
EvoMaster white-box driver, and runs EvoMaster against the generated API.

The Form CRUD GUI regression starts the generated Angular app locally, logs in
as `admin/admin`, opens the Form CRUD UI, verifies the resource panel behavior,
loads list operations, opens detail forms, exercises accordion expansion,
submits generated create forms, verifies delete flows for created rows where a
delete operation exists, and opens configured reference pickers. Generated create
forms and create responses are treated as real regression checks by default:
invalid generated defaults or non-2xx create responses fail the GUI phase. It
stores screenshots and
`form-crud-gui-smoke.json` under the artifact output folder. Keep Playwright
installed locally and set `FORM_CRUD_GUI_PLAYWRIGHT_ROOT` when it is not in the
generated app's `node_modules`; no browser evidence is uploaded by the harness.
`full_matrix.sh` also aggregates those Playwright reports into
`full-matrix-form-crud-gui-status.json` and embeds the same data under
`formCrudGui` in `full-matrix-summary.json`, including resource coverage,
create/list exercise counts, failures, durations, and screenshot counts.

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
FORM_CRUD_GUI_ENABLED=true
FORM_CRUD_GUI_PLAYWRIGHT_ROOT=/tmp/playwright-tests
FORM_CRUD_GUI_PORT=4201
FORM_CRUD_GUI_MAX_LIST_RESOURCES=all
FORM_CRUD_GUI_MAX_CREATE_RESOURCES=all
FORM_CRUD_GUI_EXERCISE_CREATE=true
FORM_CRUD_GUI_EXERCISE_DELETE=true
FORM_CRUD_GUI_FULL_PAGE_SCREENSHOTS=true
FORM_CRUD_GUI_FAIL_ON_CONSOLE_ERROR=true
FORM_CRUD_GUI_FAIL_ON_INVALID_CREATE_FORM=true
FORM_CRUD_GUI_FAIL_ON_CREATE_HTTP_ERROR=true
EVOMASTER_JAR=/home/aruvic/development/tools/evomaster/evomaster-6.0.0.jar
EVOMASTER_MODE=coverage
EVOMASTER_SECONDS_PER_API=600
EVOMASTER_CONTROLLER_PORT=40100
EVOMASTER_OUTPUT_FORMAT=JAVA_JUNIT_5
EVOMASTER_MINIMIZE_TIMEOUT_MINUTES=0
EVOMASTER_TCP_TIMEOUT_MS=10000
EVOMASTER_TEST_TIMEOUT=30
EVOMASTER_SECURITY=false
EVOMASTER_XSS=false
EVOMASTER_EXTRA_HEADER=false
EVOMASTER_EXTRA_QUERY_PARAM=false
EVOMASTER_ACCEPT_HEADER=application/json
EVOMASTER_SEED_FROM_SMOKE=false
EVOMASTER_FAIL_ON_FAULTS=true
EVOMASTER_FAIL_ON_WRITER_WARNINGS=false
EVOMASTER_SKIP_FAILURE_SQL_IN_TEST_FILE=true
EVOMASTER_ADAPTIVE_GENE_SELECTION_METHOD=NONE
EVOMASTER_ARCHIVE_GENE_MUTATION=NONE
EVOMASTER_PROB_NAMED_EXAMPLES=1.0
EVOMASTER_GENERATE_SQL_DATA_WITH_SEARCH=false
EVOMASTER_ALLOW_INVALID_DATA=false
EVOMASTER_RESOURCE_SAMPLE_STRATEGY=ConArchive
EVOMASTER_PROB_OF_SMART_SAMPLING=0.95
EVOMASTER_PROB_OF_ENABLING_RESOURCE_DEPENDENCY_HEURISTICS=0.95
EVOMASTER_PROB_USE_REST_LINKS=0.8
EVOMASTER_MAX_TEST_SIZE=20
EVOMASTER_EXPAND_REST_INDIVIDUALS=true
EVOMASTER_TAINT_ON_SAMPLING=true
EVOMASTER_USE_RESPONSE_DATA_POOL=true
EVOMASTER_COVERAGE_SWEEP_ENABLED=auto
EVOMASTER_COVERAGE_SWEEP_SECONDS_PER_ENDPOINT=30
EVOMASTER_COVERAGE_SWEEP_MINIMIZE_TIMEOUT_MINUTES=0
EVOMASTER_COVERAGE_SWEEP_MAX_ENDPOINTS=6
EVOMASTER_COVERAGE_SWEEP_AUTO_MAX_DECLARED_ENDPOINTS=10
EVOMASTER_COVERAGE_SWEEP_AUTO_SEEDED_APIS=true
EVOMASTER_COVERAGE_SWEEP_EXTRA_TIMEOUT_SECONDS=90
EVOMASTER_COVERAGE_SWEEP_MAX_WALL_SECONDS=420
EVOMASTER_COVERAGE_SWEEP_STOP_AFTER_NO_GAIN=3
EVOMASTER_COVERAGE_SWEEP_ALLOW_INVALID_DATA=false
EVOMASTER_COVERAGE_SWEEP_PROB_NAMED_EXAMPLES=1.0
EVOMASTER_COVERAGE_SWEEP_PROB_REST_EXAMPLES=1.0
EVOMASTER_COVERAGE_SWEEP_PROB_REST_DEFAULT=0.0
EVOMASTER_COVERAGE_SWEEP_ACCEPT_HEADER=application/json
EVOMASTER_COVERAGE_SWEEP_WITH_SEEDS=false
EVOMASTER_COVERAGE_SWEEP_SECURITY=false
EVOMASTER_COVERAGE_SWEEP_EXTRA_HEADER=false
EVOMASTER_COVERAGE_SWEEP_EXTRA_QUERY_PARAM=false
EVOMASTER_TIMEOUT_KILL_AFTER_SECONDS=5
EVOMASTER_POST_SEARCH_TIMEOUT_PERCENT=100
RUNTIME_FAIL_FAST=false
EVOMASTER_PACKAGES_TO_SKIP_INSTRUMENTATION=com.example.evomaster,org.example.optional.
EVOMASTER_JAVA_OPTS="-Xms512m -Xmx4g"
```

Runtime failures are collected across the matrix by default. Set
`RUNTIME_FAIL_FAST=true` to stop at the first EvoMaster failure; otherwise the
loop records failures in `$OUTPUT_DIR/runtime-summary.json` and exits nonzero
after every matched artifact has been attempted.

EvoMaster evidence is stored under
`$OUTPUT_DIR/<artifact>/evomaster/`, including the generated tests, WFC report,
statistics CSV, driver log, EvoMaster log, `faults-summary.json`, and
`status.json`. `EVOMASTER_FAIL_ON_FAULTS` defaults to `true`; set it to `false`
only when collecting exploratory findings without failing the loop.
Generated-test writer warnings are counted separately in `status.json`. They
default to non-fatal because EvoMaster can skip unprintable SQL setup commands
while still producing the API fault report and generated tests; set
`EVOMASTER_FAIL_ON_WRITER_WARNINGS=true` when auditing EvoMaster output itself.
`EVOMASTER_MODE=coverage` keeps minimization off by default so wall-clock time
tracks the fuzzing budget more closely; override `EVOMASTER_MINIMIZE_TIMEOUT_MINUTES`
when minimized generated tests are more important than matrix throughput.
`status.json` also records endpoint reachability as `declaredEndpointCount`,
`exercisedEndpointCount`, `successfulEndpointCount`, `exercisedEndpointIds`,
`covered2xxEndpointIds`, and `missing2xxEndpointIds` so negative/error testing
does not hide API-method coverage gaps. It also records `startIso`, `endIso`,
`durationSeconds`, `mainStartIso`, `mainEndIso`, `mainDurationSeconds`,
`minimizeTimeoutMinutes`, `extraTimeoutSeconds`, `prematureStop`,
`completionGraceSeconds`, and the configured EvoMaster budget, which makes
long-running phases visible in the machine-readable reports. In coverage mode,
the default wall timeout also reserves post-search time equal to the larger of
`EVOMASTER_EXTRA_TIMEOUT_SECONDS` and `EVOMASTER_POST_SEARCH_TIMEOUT_PERCENT`
percent of `EVOMASTER_SECONDS_PER_API`, because EvoMaster 6.0 can still spend
significant time recomputing coverage and writing the report after the search
budget is consumed. The harness watches
the local EvoMaster log/report and terminates lingering Java threads after a
successful completion grace period instead of waiting for the outer timeout.
EvoMaster statistics are copied into status as
`evomasterEvaluatedTests`, `evomasterEvaluatedActions`,
`evomasterCoveredTargets`, `evomasterCoveredLines`, `evomasterNumberOfLines`,
`evomasterLineCoverageRatio`, `evomasterCoveredBranches`,
`evomasterNumberOfBranches`, and `evomasterBranchCoverageRatio`.

`EVOMASTER_MODE=coverage` is the default CI-friendly mode. It disables
EvoMaster security/XSS phases and synthetic extra headers/query parameters, and
uses smoke-derived OpenAPI examples by default to improve sunny-day 2xx
reachability without relying on EvoMaster's experimental Postman seed parser.
It also sends `Accept: application/json` by default so content-negotiation fuzzing
does not crowd out 2xx coverage; set `EVOMASTER_ACCEPT_HEADER=` for unrestricted
Accept mutation in deeper negative runs.
When OpenAPI examples are enabled, coverage mode defaults
`EVOMASTER_POSTMAN_SEEDS_WITH_OPENAPI_EXAMPLES=false`; set it to `true` only
when explicitly auditing Postman seeding behavior for an API.
Coverage mode also defaults `EVOMASTER_SEED_FROM_SMOKE=false`, so Postman seed
collections are not generated or imported unless explicitly requested. The
stable coverage path is OpenAPI examples, white-box feedback, auth configuration,
and live database state.
`EVOMASTER_SEED_BODY_MODE=safe` sanitizes request bodies for EvoMaster 6.0.0 by
omitting nullable body values that can crash the Postman seed parser, while
retaining bodyless/path/query/auth seeds and simple writable bodies. Set
`EVOMASTER_SEED_BODY_MODE=full` to preserve request bodies exactly for a deep
seed-parser audit, or `EVOMASTER_SEED_BODY_MODE=none` to keep only bodyless seed
requests. Postman seed collections omit auth/content negotiation headers by
default because white-box authentication is supplied through EvoMaster driver
configuration and media types are available from OpenAPI; set
`EVOMASTER_SEED_INCLUDE_AUTHORIZATION=true` or
`EVOMASTER_SEED_INCLUDE_STANDARD_HEADERS=true` for parser compatibility audits.
If EvoMaster still fails while parsing seeds, the harness records that parser
failure and retries without seeds. Use another mode, or set
`EVOMASTER_SECURITY=true`,
`EVOMASTER_EXTRA_HEADER=true`, or `EVOMASTER_EXTRA_QUERY_PARAM=true`, for deeper
negative/security fuzzing after coverage smoke is stable. When smoke seeding is
enabled, `status.json` includes `seedSummary`, `seedParserWarningCount`,
`seedMissingRequiredParameterWarningCount`, and `seedExperimentalWarningCount`
so seed preparation and parser behavior can be compared against endpoint
coverage.

Coverage mode also defaults `EVOMASTER_REUSE_SMOKE_DB_STATE=true`. The smoke
phase creates deterministic resources by exercising valid operations; reusing
that database as EvoMaster's initial state gives resource-dependent GET, PUT,
PATCH, and DELETE searches a valid starting point without hardcoding any entity
or endpoint. Set `EVOMASTER_REUSE_SMOKE_DB_STATE=false` when testing EvoMaster
from a clean database is more important than sunny-day method reachability.
When reuse is enabled, `EVOMASTER_PREPARE_LIVE_DB_STATE=true` runs one extra
schema-driven smoke pass with DELETE skipped before EvoMaster starts. The normal
smoke pass still validates DELETE and cleans up its own resources; the extra pass
leaves generic live resources for EvoMaster to discover. The harness then
refreshes the OpenAPI example override from that live-state smoke summary, so
request examples refer to rows that actually remain in the database. If Postman
seeds are explicitly enabled, their path IDs are refreshed from the same live
state. Path parameters may be declared by OpenAPI `$ref`; the example override
resolves those references before adding smoke-derived examples.
Coverage mode also defaults `EVOMASTER_GENERATE_SQL_DATA_WITH_SEARCH=false`.
The generated app is still tested in white-box mode with SQL instrumentation and
SQL heuristics, but EvoMaster does not create arbitrary SQL rows directly. This
keeps sunny-day coverage focused on valid API-created state and avoids false
5xx findings from referentially-invalid database rows that no REST workflow
would have persisted. Enable it explicitly for deeper database-state fuzzing.

`EVOMASTER_PROB_NAMED_EXAMPLES=1.0`, `EVOMASTER_PROB_REST_EXAMPLES=0.7`, and
`EVOMASTER_PROB_REST_DEFAULT=0.3` tell EvoMaster to prefer OpenAPI examples and
defaults when present. EvoMaster requires the example/default probabilities to
sum to at most 1. Coverage mode also sets `EVOMASTER_ALLOW_INVALID_DATA=false`
so the first pass spends more time on valid request shapes and 2xx reachability
instead of negative fuzzing. Stable coverage settings keep EvoMaster's
resource-based REST sampler enabled through `EVOMASTER_RESOURCE_SAMPLE_STRATEGY`,
`EVOMASTER_PROB_OF_SMART_SAMPLING`,
`EVOMASTER_PROB_OF_ENABLING_RESOURCE_DEPENDENCY_HEURISTICS`,
`EVOMASTER_PROB_USE_REST_LINKS`, `EVOMASTER_MAX_TEST_SIZE`,
`EVOMASTER_EXPAND_REST_INDIVIDUALS`, `EVOMASTER_TAINT_ON_SAMPLING`, and
`EVOMASTER_USE_RESPONSE_DATA_POOL`. The stable profile also sets
`EVOMASTER_ADAPTIVE_GENE_SELECTION_METHOD=NONE` and
`EVOMASTER_ARCHIVE_GENE_MUTATION=NONE`. EvoMaster 6.0.0 defaults those internal
mutation features on, but they have crashed on generated polymorphic OpenAPI
schemas while comparing optional/object genes. Re-enable them only for an
isolated EvoMaster bug audit or when validating a newer EvoMaster build. After
the main run, the harness can run bounded focused passes
for endpoints still missing 2xx coverage. In coverage mode,
`EVOMASTER_COVERAGE_SWEEP_ENABLED=auto` runs focused sweeps only for small APIs,
when `EVOMASTER_COVERAGE_SWEEP_AUTO_SMALL_APIS=true`, or when smoke seeds are
active and `EVOMASTER_COVERAGE_SWEEP_AUTO_SEEDED_APIS=true`. Coverage mode
defaults `EVOMASTER_COVERAGE_SWEEP_WITH_SEEDS=false`, because EvoMaster 6.0.0's
Postman seed parser is experimental and can crash on polymorphic `oneOf`/`anyOf`
schemas represented internally as choice genes. Focused sweeps still use the
OpenAPI schema, white-box feedback, smoke-derived OpenAPI examples, and live
database state. Set `EVOMASTER_COVERAGE_SWEEP_WITH_SEEDS=true` only when a run
is explicitly auditing Postman seed parsing or when a specific API benefits from
stable seed import. Set
`EVOMASTER_COVERAGE_SWEEP_ENABLED=true` for explicit deep runs, or adjust
`EVOMASTER_COVERAGE_SWEEP_AUTO_MAX_DECLARED_ENDPOINTS` and
`EVOMASTER_COVERAGE_SWEEP_AUTO_SMALL_APIS` to tune the small API threshold.
Focused sweep candidates are
ordered to try resource-style GET/PATCH/PUT/POST operations before listener
event POSTs and DELETEs, because listener/event endpoints tend to be covered
reliably by smoke tests but are low-yield for short EvoMaster sweeps. The
focused sweep is controlled by `EVOMASTER_COVERAGE_SWEEP_ENABLED`,
`EVOMASTER_COVERAGE_SWEEP_SECONDS_PER_ENDPOINT`, and
`EVOMASTER_COVERAGE_SWEEP_MAX_ENDPOINTS`; `status.json` records
`coverageSweepRequested`, `coverageSweepEnabled`, `coverageSweepRunCount`,
`coverageSweepAttemptedEndpointIds`, `coverageSweepReports`, `coverageSweepGainCount`,
`coverageSweepTotalDurationSeconds`, and `coverageSweepStopReason`. EvoMaster
6.0.0 focuses by OpenAPI path, so the harness deduplicates missing method IDs by
path for focused runs while keeping method-level 2xx coverage in the reports.
The focused pass deliberately uses a more 2xx-oriented EvoMaster profile than
the main fuzzing pass: `EVOMASTER_COVERAGE_SWEEP_ALLOW_INVALID_DATA=false`,
`EVOMASTER_COVERAGE_SWEEP_PROB_NAMED_EXAMPLES=1.0`,
`EVOMASTER_COVERAGE_SWEEP_PROB_REST_EXAMPLES=1.0`, and
`EVOMASTER_COVERAGE_SWEEP_PROB_REST_DEFAULT=0.0`. This follows EvoMaster's REST
builder behavior: schema examples are represented as choice genes, and setting
the example probability to `1.0` makes the initial focused search prefer those
valid shapes instead of random main genes. `EVOMASTER_COVERAGE_SWEEP_ACCEPT_HEADER`
can be set to an empty value for a focused run if missing endpoints are dominated
by 406 responses and content negotiation needs to be fuzzed separately.
If focused Postman seeds are enabled, sweeps use only the matching
smoke-derived seed for the selected method/path. If EvoMaster crashes while
parsing a focused seed, the sweep records the seeded failure log and retries
without the seed. Set `EVOMASTER_COVERAGE_SWEEP_RETRY_PATH_ONLY_SEEDS=true` to
insert a path-only seed retry between those two attempts when investigating the
EvoMaster seed parser itself.

Do not use Postman seeds as the default second-cycle coverage mechanism for
polymorphic OpenAPI schemas. EvoMaster 6.0.0 marks `seedTestCases`/Postman import
as experimental, and its Postman parser currently fails before search when a
seeded request maps to a `ChoiceGene` generated from `oneOf`/`anyOf`, examples,
or other alternative schemas. The stable second cycle is OpenAPI examples plus
`endpointFocus`/`endpointPrefix`; Postman seeds are an opt-in diagnostic or a
future local EvoMaster patch target. A narrow source patch for EvoMaster
6.0.1-SNAPSHOT is stored in
`test/oas-regression/patches/evomaster-6.0.1-postman-choicegene.patch`; apply it
to a local EvoMaster checkout and point `EVOMASTER_JAR` at the rebuilt shaded jar
when exact smoke-request replay is needed for a deep coverage run.

Focused sweeps are bounded separately from the main run:
`EVOMASTER_COVERAGE_SWEEP_MINIMIZE_TIMEOUT_MINUTES` keeps per-sweep
minimization short, `EVOMASTER_COVERAGE_SWEEP_MAX_WALL_SECONDS` caps total sweep
wall time per API, and `EVOMASTER_COVERAGE_SWEEP_STOP_AFTER_NO_GAIN` stops after
consecutive focused runs that add no new 2xx method coverage. Set
`EVOMASTER_COVERAGE_SWEEP_ENABLED=false` or lower the per-endpoint seconds/max
endpoints for short CI jobs.
If a focused sweep reaches its wrapper timeout after writing a report with zero
faults, the harness records it as a no-gain sweep instead of failing the API;
reports containing faults or missing reports remain failures.
After the first focused sweep, the harness also uses the measured average sweep
duration to avoid starting another sweep that is projected to exceed the wall
cap; that stop is reported as `projected-max-wall-seconds`.

Focused sweeps default to coverage mode while still preserving authentication:
`EVOMASTER_COVERAGE_SWEEP_SECURITY=false`,
`EVOMASTER_COVERAGE_SWEEP_EXTRA_HEADER=false`, and
`EVOMASTER_COVERAGE_SWEEP_EXTRA_QUERY_PARAM=false`.

The generated white-box controller skips instrumentation of its own generated
`evomaster` test package and known optional framework classes that commonly fail
bytecode instrumentation when optional dependencies are absent. Override
`EVOMASTER_PACKAGES_TO_SKIP_INSTRUMENTATION` with a comma-separated prefix list
to tune this per generated app without changing generated source.
The controller also preserves regex patterns on OpenAPI operation parameters
while still allowing broader schema-pattern sanitization. Query/path/header
patterns often describe the only valid values that reach 2xx responses, so
keeping them improves EvoMaster API-method coverage without hardcoding any
artifact-specific values.

`EVOMASTER_XSS` defaults to `false` because these generated REST endpoints return
JSON and commonly echo persisted string fields. Enable it explicitly for APIs
that return browser-rendered HTML or other executable content.

The generated EvoMaster driver feeds EvoMaster a normalized copy of the source
OpenAPI document. It preserves the API operations while adapting tool/runtime
edges: path-level parameters are moved onto operations, discriminator `allOf`
subtypes are flattened for EvoMaster, and standard generated JHipster framework
responses such as empty 401/403/404 and `application/problem+json`
400/406/409/415 are added so schema oracles focus on generated server defects.
When the harness writes an OpenAPI override with smoke examples, it also applies
the same generic problem-details response augmentation and removes response
content entries that declare media types without schemas, avoiding a mismatch
between the override and the generated white-box driver schema.
