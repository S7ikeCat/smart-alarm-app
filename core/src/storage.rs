use rusqlite::{Connection, Result};
use crate::DayType;

/// Открывает (или создаёт) БД по указанному пути и накатывает схему,
/// если таблиц ещё нет. `CREATE TABLE IF NOT EXISTS` — идемпотентно,
/// можно звать при каждом запуске приложения без риска стереть данные.
pub fn init_db(path: &str) -> Result<Connection> {
    let conn = Connection::open(path)?;
    conn.execute_batch("PRAGMA foreign_keys = ON;")?;

    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS work_schedules (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            color TEXT,
            pattern_json TEXT NOT NULL,
            source_json TEXT NOT NULL,
            start_date TEXT NOT NULL,
            shift_start_time TEXT NOT NULL,
            alarms_json TEXT NOT NULL,
            is_active INTEGER DEFAULT 1,
            is_paused INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS alarm_instances (
            id TEXT PRIMARY KEY,
            schedule_id TEXT REFERENCES work_schedules(id) ON DELETE CASCADE,
            date TEXT NOT NULL,
            time_local TEXT NOT NULL,
            status TEXT NOT NULL,
            origin TEXT NOT NULL
        );
        ",
    )?;

    Ok(conn)
}

use crate::WorkSchedule;

/// Сохраняет график работы в БД. Если график с таким id уже есть —
/// перезаписывает его (UPSERT), это упрощает жизнь: не нужно отдельно
/// думать "это insert или update", вызывающий код просто сохраняет.
pub fn save_work_schedule(conn: &Connection, schedule: &WorkSchedule) -> Result<()> {
    let pattern_json = serde_json::to_string(&schedule.pattern)
        .expect("SchedulePattern serialization should never fail");
    let source_json = serde_json::to_string(&schedule.source)
        .expect("ScheduleSource serialization should never fail");
    let alarms_json = serde_json::to_string(&schedule.alarms)
        .expect("Vec<AlarmRule> serialization should never fail");

    conn.execute(
        "INSERT INTO work_schedules
            (id, name, color, pattern_json, source_json, start_date, shift_start_time, alarms_json, is_active, is_paused)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
         ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            color = excluded.color,
            pattern_json = excluded.pattern_json,
            source_json = excluded.source_json,
            start_date = excluded.start_date,
            shift_start_time = excluded.shift_start_time,
            alarms_json = excluded.alarms_json,
            is_active = excluded.is_active,
            is_paused = excluded.is_paused",
        (
            schedule.id.to_string(),
            &schedule.name,
            &schedule.color,
            pattern_json,
            source_json,
            schedule.start_date.to_string(),
            schedule.shift_start_time.to_string(),
            alarms_json,
            schedule.is_active,
            schedule.is_paused,
        ),
    )?;

    Ok(())
}

/// Загружает все графики работы из БД, десериализуя JSON-поля обратно
/// в Rust-структуры (SchedulePattern, ScheduleSource, Vec<AlarmRule>).
pub fn load_work_schedules(conn: &Connection) -> Result<Vec<WorkSchedule>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, color, pattern_json, source_json, start_date,
                shift_start_time, alarms_json, is_active, is_paused
         FROM work_schedules",
    )?;

    let rows = stmt.query_map([], |row| {
        let id_str: String = row.get(0)?;
        let pattern_json: String = row.get(3)?;
        let source_json: String = row.get(4)?;
        let start_date_str: String = row.get(5)?;
        let shift_start_time_str: String = row.get(6)?;
        let alarms_json: String = row.get(7)?;

        Ok(WorkSchedule {
            id: id_str.parse().expect("stored id should always be valid UUID"),
            name: row.get(1)?,
            color: row.get(2)?,
            pattern: serde_json::from_str(&pattern_json)
                .expect("stored pattern_json should always be valid"),
            source: serde_json::from_str(&source_json)
                .expect("stored source_json should always be valid"),
            start_date: start_date_str
                .parse()
                .expect("stored start_date should always be valid"),
            shift_start_time: shift_start_time_str
                .parse()
                .expect("stored shift_start_time should always be valid"),
            alarms: serde_json::from_str(&alarms_json)
                .expect("stored alarms_json should always be valid"),
            is_active: row.get(8)?,
            is_paused: row.get(9)?,
        })
    })?;

    rows.collect()
}

use uuid::Uuid;
use crate::{AlarmInstance, InstanceStatus, AlarmOrigin};

/// Сохраняет пачку инстансов будильников одной транзакцией — важно для
/// производительности, когда generate_instances() выдаёт сотни записей
/// на 6-12 месяцев вперёд разом, а не по одной строке.
pub fn save_alarm_instances(conn: &mut Connection, instances: &[AlarmInstance]) -> Result<()> {
    let tx = conn.transaction()?;

    for instance in instances {
        let status_str = match instance.status {
            InstanceStatus::Active => "active",
            InstanceStatus::SkippedByUser => "skipped_by_user",
            InstanceStatus::Fired => "fired",
            InstanceStatus::Missed => "missed",
        };
        let origin_str = match instance.origin {
            AlarmOrigin::FromPattern => "from_pattern",
            AlarmOrigin::ManualOverride => "manual_override",
            AlarmOrigin::TimezoneMeeting => "timezone_meeting",
        };

        tx.execute(
            "INSERT INTO alarm_instances (id, schedule_id, date, time_local, status, origin)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(id) DO UPDATE SET
                status = excluded.status,
                origin = excluded.origin",
            (
                instance.id.to_string(),
                instance.schedule_id.to_string(),
                instance.date.to_string(),
                instance.time_local.to_string(),
                status_str,
                origin_str,
            ),
        )?;
    }

    tx.commit()
}

/// Загружает все инстансы будильников для конкретного графика.
pub fn load_alarm_instances(conn: &Connection, schedule_id: Uuid) -> Result<Vec<AlarmInstance>> {
    let mut stmt = conn.prepare(
        "SELECT id, schedule_id, date, time_local, status, origin
         FROM alarm_instances WHERE schedule_id = ?1",
    )?;

    let rows = stmt.query_map([schedule_id.to_string()], |row| {
        let id_str: String = row.get(0)?;
        let schedule_id_str: String = row.get(1)?;
        let date_str: String = row.get(2)?;
        let time_str: String = row.get(3)?;
        let status_str: String = row.get(4)?;
        let origin_str: String = row.get(5)?;

        let status = match status_str.as_str() {
            "active" => InstanceStatus::Active,
            "skipped_by_user" => InstanceStatus::SkippedByUser,
            "fired" => InstanceStatus::Fired,
            "missed" => InstanceStatus::Missed,
            other => panic!("unknown instance status in DB: {other}"),
        };
        let origin = match origin_str.as_str() {
            "from_pattern" => AlarmOrigin::FromPattern,
            "manual_override" => AlarmOrigin::ManualOverride,
            "timezone_meeting" => AlarmOrigin::TimezoneMeeting,
            other => panic!("unknown alarm origin in DB: {other}"),
        };

        Ok(AlarmInstance {
            id: id_str.parse().expect("stored id should always be valid UUID"),
            schedule_id: schedule_id_str.parse().expect("stored schedule_id should always be valid UUID"),
            date: date_str.parse().expect("stored date should always be valid"),
            time_local: time_str.parse().expect("stored time_local should always be valid"),
            status,
            origin,
        })
    })?;

    rows.collect()
}

use crate::AlarmCoreError;

/// FFI-обёртка: открывает БД по пути, сохраняет график, закрывает соединение.
/// Мобильная сторона не должна управлять нативным Connection через границу FFI —
/// поэтому вся работа с файлом происходит внутри одного вызова.
#[uniffi::export]
pub fn save_work_schedule_ffi(db_path: String, schedule: WorkSchedule) -> Result<(), AlarmCoreError> {
    let conn = init_db(&db_path).map_err(|e| AlarmCoreError::DatabaseError { details: e.to_string() })?;
    save_work_schedule(&conn, &schedule)
        .map_err(|e| AlarmCoreError::DatabaseError { details: e.to_string() })
}

/// FFI-обёртка: открывает БД, загружает все графики, закрывает соединение.
#[uniffi::export]
pub fn load_work_schedules_ffi(db_path: String) -> Result<Vec<WorkSchedule>, AlarmCoreError> {
    let conn = init_db(&db_path).map_err(|e| AlarmCoreError::DatabaseError { details: e.to_string() })?;
    load_work_schedules(&conn).map_err(|e| AlarmCoreError::DatabaseError { details: e.to_string() })
}

/// FFI-обёртка: открывает БД, удаляет график по id (вместе со всеми его
/// инстансами благодаря ON DELETE — см. ниже), закрывает соединение.
#[uniffi::export]
pub fn delete_work_schedule_ffi(db_path: String, schedule_id: Uuid) -> Result<(), AlarmCoreError> {
    let conn = init_db(&db_path).map_err(|e| AlarmCoreError::DatabaseError { details: e.to_string() })?;
    conn.execute(
        "DELETE FROM work_schedules WHERE id = ?1",
        [schedule_id.to_string()],
    )
    .map_err(|e| AlarmCoreError::DatabaseError { details: e.to_string() })?;
    Ok(())
}

/// Делает ровно один график активным, снимая активность со всех
/// остальных — гарантирует правило "строго один активный график"
/// на уровне данных, а не полагается на аккуратность мобильной стороны.
#[uniffi::export]
pub fn set_active_schedule_ffi(db_path: String, schedule_id: Uuid) -> Result<(), AlarmCoreError> {
    let conn = init_db(&db_path).map_err(|e| AlarmCoreError::DatabaseError { details: e.to_string() })?;

    let tx = conn.unchecked_transaction()
        .map_err(|e| AlarmCoreError::DatabaseError { details: e.to_string() })?;

    tx.execute("UPDATE work_schedules SET is_active = 0", [])
        .map_err(|e| AlarmCoreError::DatabaseError { details: e.to_string() })?;

    tx.execute(
        "UPDATE work_schedules SET is_active = 1 WHERE id = ?1",
        [schedule_id.to_string()],
    )
    .map_err(|e| AlarmCoreError::DatabaseError { details: e.to_string() })?;

    tx.commit().map_err(|e| AlarmCoreError::DatabaseError { details: e.to_string() })?;

    Ok(())
}

/// Генерирует и объединяет предстоящие будильники всех активных графиков
/// за один вызов — мобильной стороне не нужно знать, сколько графиков есть
/// и как их правильно смешивать между собой.
#[uniffi::export]
pub fn generate_upcoming_alarms_ffi(
    db_path: String,
    horizon_months: u32,
) -> Result<Vec<AlarmInstance>, AlarmCoreError> {
    let conn = init_db(&db_path)
        .map_err(|e| AlarmCoreError::DatabaseError { details: e.to_string() })?;
    let schedules = load_work_schedules(&conn)
        .map_err(|e| AlarmCoreError::DatabaseError { details: e.to_string() })?;

    let mut all_instances: Vec<AlarmInstance> = Vec::new();
    for schedule in schedules.iter().filter(|s| s.is_active) {
        let instances = crate::generate_instances(schedule, horizon_months);
        all_instances.extend(instances);
    }

    all_instances.sort_by(|a, b| (a.date, a.time_local).cmp(&(b.date, b.time_local)));

    Ok(all_instances)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{AlarmRule, ScheduleSource, SchedulePattern};
    use chrono::{NaiveDate, NaiveTime};
    use uuid::Uuid;

    #[test]
    fn save_and_load_roundtrip_preserves_schedule() {
        // Временный файл в системной temp-папке — тест сам создаёт и не оставляет мусора
        let db_path = std::env::temp_dir().join(format!("test_{}.db", Uuid::new_v4()));
        let db_path_str = db_path.to_str().unwrap();

        let conn = init_db(db_path_str).unwrap();

        let schedule = WorkSchedule {
            id: Uuid::new_v4(),
            name: "Основная работа".to_string(),
            color: "#FF0000".to_string(),
            pattern: SchedulePattern::Cyclic { work_days: 2, rest_days: 2 },
            source: ScheduleSource::Preset("cycle_2_2".to_string()),
            start_date: NaiveDate::from_ymd_opt(2026, 1, 1).unwrap(),
            shift_start_time: NaiveTime::from_hms_opt(8, 0, 0).unwrap(),
            alarms: vec![AlarmRule {
                id: Uuid::new_v4(),
                offset_minutes: 30,
                ringtone_id: "default".to_string(),
                vibration: true,
            }],
            is_active: true,
            is_paused: false,
        };

        save_work_schedule(&conn, &schedule).unwrap();

        let loaded = load_work_schedules(&conn).unwrap();

        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].id, schedule.id);
        assert_eq!(loaded[0].name, schedule.name);
        assert_eq!(loaded[0].start_date, schedule.start_date);
        assert_eq!(loaded[0].shift_start_time, schedule.shift_start_time);

        // Убираем за собой временный файл
        std::fs::remove_file(db_path).ok();
    }

    #[test]
fn save_and_load_instances_roundtrip() {
    let db_path = std::env::temp_dir().join(format!("test_{}.db", Uuid::new_v4()));
    let db_path_str = db_path.to_str().unwrap();

    let mut conn = init_db(db_path_str).unwrap();

    // Сначала сохраняем родительский график — иначе foreign key не пропустит инстансы
    let schedule = WorkSchedule {
        id: Uuid::new_v4(),
        name: "Test Schedule".to_string(),
        color: "#FF0000".to_string(),
        pattern: SchedulePattern::Cyclic { work_days: 2, rest_days: 2 },
        source: ScheduleSource::Preset("cycle_2_2".to_string()),
        start_date: NaiveDate::from_ymd_opt(2026, 1, 1).unwrap(),
        shift_start_time: NaiveTime::from_hms_opt(8, 0, 0).unwrap(),
        alarms: vec![],
        is_active: true,
        is_paused: false,
    };
    save_work_schedule(&conn, &schedule).unwrap();

    let schedule_id = schedule.id;
    let instances = vec![
        AlarmInstance {
            id: Uuid::new_v4(),
            schedule_id,
            date: NaiveDate::from_ymd_opt(2026, 1, 1).unwrap(),
            time_local: NaiveTime::from_hms_opt(7, 30, 0).unwrap(),
            status: crate::InstanceStatus::Active,
            origin: crate::AlarmOrigin::FromPattern,
        },
        AlarmInstance {
            id: Uuid::new_v4(),
            schedule_id,
            date: NaiveDate::from_ymd_opt(2026, 1, 2).unwrap(),
            time_local: NaiveTime::from_hms_opt(7, 30, 0).unwrap(),
            status: crate::InstanceStatus::SkippedByUser,
            origin: crate::AlarmOrigin::ManualOverride,
        },
    ];

    save_alarm_instances(&mut conn, &instances).unwrap();

    let loaded = load_alarm_instances(&conn, schedule_id).unwrap();

    assert_eq!(loaded.len(), 2);
    assert!(loaded.iter().any(|i| i.status == crate::InstanceStatus::Active));
    assert!(loaded.iter().any(|i| i.status == crate::InstanceStatus::SkippedByUser));

    std::fs::remove_file(db_path).ok();
}

#[test]
fn ffi_save_and_load_roundtrip() {
    let db_path = std::env::temp_dir().join(format!("test_ffi_{}.db", Uuid::new_v4()));
    let db_path_str = db_path.to_str().unwrap().to_string();

    let schedule = WorkSchedule {
        id: Uuid::new_v4(),
        name: "FFI Test".to_string(),
        color: "#E8875A".to_string(),
        pattern: SchedulePattern::Custom(vec![DayType::Work, DayType::Rest]),
        source: ScheduleSource::Custom,
        start_date: NaiveDate::from_ymd_opt(2026, 1, 1).unwrap(),
        shift_start_time: NaiveTime::from_hms_opt(8, 0, 0).unwrap(),
        alarms: vec![],
        is_active: true,
        is_paused: false,
    };

    save_work_schedule_ffi(db_path_str.clone(), schedule.clone()).unwrap();

    let loaded = load_work_schedules_ffi(db_path_str).unwrap();

    assert_eq!(loaded.len(), 1);
    assert_eq!(loaded[0].id, schedule.id);
    assert_eq!(loaded[0].name, "FFI Test");

    std::fs::remove_file(db_path).ok();
}

#[test]
fn set_active_schedule_makes_exactly_one_active() {
    let db_path = std::env::temp_dir().join(format!("test_active_{}.db", Uuid::new_v4()));
    let db_path_str = db_path.to_str().unwrap().to_string();

    let conn = init_db(&db_path_str).unwrap();

    let schedule_a = WorkSchedule {
        id: Uuid::new_v4(),
        name: "График A".to_string(),
        color: "#E8875A".to_string(),
        pattern: SchedulePattern::Custom(vec![DayType::Work, DayType::Rest]),
        source: ScheduleSource::Custom,
        start_date: NaiveDate::from_ymd_opt(2026, 1, 1).unwrap(),
        shift_start_time: NaiveTime::from_hms_opt(8, 0, 0).unwrap(),
        alarms: vec![],
        is_active: true,
        is_paused: false,
    };
    let schedule_b = WorkSchedule {
        id: Uuid::new_v4(),
        name: "График B".to_string(),
        is_active: false,
        ..schedule_a.clone()
    };

    save_work_schedule(&conn, &schedule_a).unwrap();
    save_work_schedule(&conn, &schedule_b).unwrap();

    // Переключаем активность на B — A должен погаснуть
    set_active_schedule_ffi(db_path_str.clone(), schedule_b.id).unwrap();

    let loaded = load_work_schedules_ffi(db_path_str).unwrap();
    let loaded_a = loaded.iter().find(|s| s.id == schedule_a.id).unwrap();
    let loaded_b = loaded.iter().find(|s| s.id == schedule_b.id).unwrap();

    assert_eq!(loaded_a.is_active, false);
    assert_eq!(loaded_b.is_active, true);

    std::fs::remove_file(db_path).ok();
}

#[test]
fn generate_upcoming_alarms_merges_only_active_schedules() {
    let db_path = std::env::temp_dir().join(format!("test_upcoming_{}.db", Uuid::new_v4()));
    let db_path_str = db_path.to_str().unwrap().to_string();

    let conn = init_db(&db_path_str).unwrap();

    let active_schedule = WorkSchedule {
        id: Uuid::new_v4(),
        name: "Активный".to_string(),
        color: "#E8875A".to_string(),
        pattern: SchedulePattern::Custom(vec![DayType::Work, DayType::Rest]),
        source: ScheduleSource::Custom,
        start_date: NaiveDate::from_ymd_opt(2026, 1, 1).unwrap(),
        shift_start_time: NaiveTime::from_hms_opt(8, 0, 0).unwrap(),
        alarms: vec![AlarmRule {
            id: Uuid::new_v4(),
            offset_minutes: 30,
            ringtone_id: "default".to_string(),
            vibration: true,
        }],
        is_active: true,
        is_paused: false,
    };
    let paused_schedule = WorkSchedule {
        id: Uuid::new_v4(),
        name: "На паузе".to_string(),
        is_active: false,
        ..active_schedule.clone()
    };

    save_work_schedule(&conn, &active_schedule).unwrap();
    save_work_schedule(&conn, &paused_schedule).unwrap();

    let instances = generate_upcoming_alarms_ffi(db_path_str, 1).unwrap();

    // Все инстансы должны принадлежать только активному графику
    assert!(instances.iter().all(|i| i.schedule_id == active_schedule.id));
    assert!(!instances.is_empty());

    // Список должен быть отсортирован по дате (не убывает)
    for pair in instances.windows(2) {
        assert!(pair[0].date <= pair[1].date);
    }

    std::fs::remove_file(db_path).ok();
}
}