#!/usr/bin/env bash

ensure_form_crud_gui_playwright_dependencies() {
  local name="$1"
  local app_dir="$2"
  local install_start install_end browser_start browser_end
  local dependency_packages=()
  local coverage_packages=()
  read -r -a dependency_packages <<< "$FORM_CRUD_GUI_PLAYWRIGHT_PACKAGE"
  if [[ "$FORM_CRUD_GUI_SOURCE_COVERAGE_ENABLED" == "true" ]]; then
    read -r -a coverage_packages <<< "$FORM_CRUD_GUI_SOURCE_COVERAGE_PACKAGES"
    dependency_packages+=("${coverage_packages[@]}")
  fi

  if FORM_CRUD_GUI_PLAYWRIGHT_ROOT="$FORM_CRUD_GUI_PLAYWRIGHT_ROOT" "$FORM_CRUD_GUI_NODE_BIN/node" \
    "$FORM_CRUD_GUI_SMOKE" --check-dependencies >/dev/null 2>&1 &&
    { [[ "$FORM_CRUD_GUI_SOURCE_COVERAGE_ENABLED" != "true" ]] ||
      FORM_CRUD_GUI_PLAYWRIGHT_ROOT="$FORM_CRUD_GUI_PLAYWRIGHT_ROOT" "$FORM_CRUD_GUI_NODE_BIN/node" \
        "$FORM_CRUD_GUI_SOURCE_COVERAGE_WORKER" --check-dependencies "$app_dir" >/dev/null 2>&1; }; then
    if [[ "$FORM_CRUD_GUI_PLAYWRIGHT_INSTALL_BROWSERS" == "skip" ]]; then
      return 0
    fi
  else
    case "$FORM_CRUD_GUI_PLAYWRIGHT_INSTALL" in
      skip)
        ;;
      offline|online)
        install_start="$(now_epoch)"
        timestamped_step "$name" "Form CRUD GUI Playwright install start ($FORM_CRUD_GUI_PLAYWRIGHT_INSTALL)"
        mkdir -p "$FORM_CRUD_GUI_PLAYWRIGHT_ROOT"
        if [[ "$FORM_CRUD_GUI_PLAYWRIGHT_INSTALL" == "offline" ]]; then
          env PATH="$FORM_CRUD_GUI_NODE_BIN:$PATH" NO_UPDATE_NOTIFIER=1 npm install \
            --prefix "$FORM_CRUD_GUI_PLAYWRIGHT_ROOT" "${dependency_packages[@]}" --offline --no-audit --no-fund < /dev/null
        else
          env PATH="$FORM_CRUD_GUI_NODE_BIN:$PATH" NO_UPDATE_NOTIFIER=1 npm install \
            --prefix "$FORM_CRUD_GUI_PLAYWRIGHT_ROOT" "${dependency_packages[@]}" --no-audit --no-fund < /dev/null
        fi
        install_end="$(now_epoch)"
        timestamped_step "$name" "Form CRUD GUI Playwright install finished in $(duration_seconds "$install_start" "$install_end")s"
        ;;
      *)
        echo "Unsupported FORM_CRUD_GUI_PLAYWRIGHT_INSTALL=$FORM_CRUD_GUI_PLAYWRIGHT_INSTALL; use offline, online, or skip." >&2
        return 2
        ;;
    esac

    FORM_CRUD_GUI_PLAYWRIGHT_ROOT="$FORM_CRUD_GUI_PLAYWRIGHT_ROOT" "$FORM_CRUD_GUI_NODE_BIN/node" \
      "$FORM_CRUD_GUI_SMOKE" --check-dependencies
    if [[ "$FORM_CRUD_GUI_SOURCE_COVERAGE_ENABLED" == "true" ]]; then
      FORM_CRUD_GUI_PLAYWRIGHT_ROOT="$FORM_CRUD_GUI_PLAYWRIGHT_ROOT" "$FORM_CRUD_GUI_NODE_BIN/node" \
        "$FORM_CRUD_GUI_SOURCE_COVERAGE_WORKER" --check-dependencies "$app_dir"
    fi
  fi

  case "$FORM_CRUD_GUI_PLAYWRIGHT_INSTALL_BROWSERS" in
    skip)
      ;;
    online)
      browser_start="$(now_epoch)"
      timestamped_step "$name" "Form CRUD GUI Playwright browser install start ($FORM_CRUD_GUI_PLAYWRIGHT_BROWSER)"
      if [[ ! -x "${FORM_CRUD_GUI_PLAYWRIGHT_ROOT%/}/node_modules/.bin/playwright" ]]; then
        mkdir -p "$FORM_CRUD_GUI_PLAYWRIGHT_ROOT"
        env PATH="$FORM_CRUD_GUI_NODE_BIN:$PATH" NO_UPDATE_NOTIFIER=1 npm install \
          --prefix "$FORM_CRUD_GUI_PLAYWRIGHT_ROOT" "${dependency_packages[@]}" --no-audit --no-fund < /dev/null
      fi
      env PATH="$FORM_CRUD_GUI_NODE_BIN:$PATH" NO_UPDATE_NOTIFIER=1 \
        "${FORM_CRUD_GUI_PLAYWRIGHT_ROOT%/}/node_modules/.bin/playwright" install "$FORM_CRUD_GUI_PLAYWRIGHT_BROWSER" < /dev/null
      browser_end="$(now_epoch)"
      timestamped_step "$name" "Form CRUD GUI Playwright browser install finished in $(duration_seconds "$browser_start" "$browser_end")s"
      ;;
    *)
      echo "Unsupported FORM_CRUD_GUI_PLAYWRIGHT_INSTALL_BROWSERS=$FORM_CRUD_GUI_PLAYWRIGHT_INSTALL_BROWSERS; use online or skip." >&2
      return 2
      ;;
  esac
}
