#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if eagle_judge_lib::voice_input::smoke_mode() {
        return;
    }
    if eagle_judge_lib::diagnostic_reports::build_info_mode() {
        return;
    }
    #[cfg(all(windows, debug_assertions))]
    if eagle_judge_lib::diagnostic_watchdog::helper_mode() {
        return;
    }
    eagle_judge_lib::run();
}
