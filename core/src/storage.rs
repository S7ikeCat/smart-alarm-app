use rusqlite::{Connection, Result};
#[allow(unused_imports)]
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
        
        CREATE TABLE IF NOT EXISTS day_overrides (
            id TEXT PRIMARY KEY,
            schedule_id TEXT NOT NULL REFERENCES work_schedules(id) ON DELETE CASCADE,
            date TEXT NOT NULL,
            is_work INTEGER NOT NULL,
            UNIQUE(schedule_id, date)
        );

        CREATE TABLE IF NOT EXISTS custom_events (
            id TEXT PRIMARY KEY,
            date TEXT NOT NULL UNIQUE,
            time_local TEXT NOT NULL,
            color TEXT NOT NULL,
            label TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            reminder_enabled INTEGER NOT NULL DEFAULT 1
        );

        CREATE TABLE IF NOT EXISTS schedule_pauses (
            id TEXT PRIMARY KEY,
            schedule_id TEXT NOT NULL REFERENCES work_schedules(id) ON DELETE CASCADE,
            start_date TEXT NOT NULL,
            end_date TEXT NOT NULL,
            label TEXT NOT NULL
        );
        ",
    )?;

    migrate(&conn)?;

    Ok(conn)
}

/// Текущая версия схемы. Увеличиваем на 1 при каждом изменении таблиц и
/// добавляем соответствующий шаг в `migrate`. Данные пользователя при этом
/// не теряются — никаких "очистить данные приложения" больше не нужно.
const SCHEMA_VERSION: i32 = 4;

/// Накатывает недостающие шаги схемы. Версия хранится в `PRAGMA user_version`
/// (0 = база создана до появления миграций; структура такая же, как v1).
/// Каждый шаг идёт в своей транзакции: либо применился целиком, либо нет.
fn migrate(conn: &Connection) -> Result<()> {
    let mut version: i32 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;

    if version < 1 {
        conn.execute_batch("PRAGMA user_version = 1;")?;
        version = 1;
    }

    if version < 2 {
        // v2: несколько событий на одну дату (убираем UNIQUE(date)),
        // дополнительные будильники, время будильника на конкретную дату.
        // SQLite не умеет снимать UNIQUE через ALTER, поэтому таблицу
        // событий пересоздаём с копированием всех строк.
        conn.execute_batch(
            "
            BEGIN;
            CREATE TABLE custom_events_new (
                id TEXT PRIMARY KEY,
                date TEXT NOT NULL,
                time_local TEXT NOT NULL,
                color TEXT NOT NULL,
                label TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                reminder_enabled INTEGER NOT NULL DEFAULT 1
            );
            INSERT INTO custom_events_new
                SELECT id, date, time_local, color, label, description, reminder_enabled
                FROM custom_events;
            DROP TABLE custom_events;
            ALTER TABLE custom_events_new RENAME TO custom_events;

            CREATE TABLE IF NOT EXISTS extra_alarms (
                id TEXT PRIMARY KEY,
                label TEXT NOT NULL DEFAULT '',
                time_local TEXT NOT NULL,
                kind TEXT NOT NULL,
                date TEXT,
                enabled INTEGER NOT NULL DEFAULT 1
            );

            CREATE TABLE IF NOT EXISTS alarm_time_overrides (
                schedule_id TEXT NOT NULL REFERENCES work_schedules(id) ON DELETE CASCADE,
                date TEXT NOT NULL,
                rule_id TEXT NOT NULL,
                time_local TEXT NOT NULL,
                PRIMARY KEY (schedule_id, date, rule_id)
            );

            PRAGMA user_version = 2;
            COMMIT;
            ",
        )?;
    }

    if version < 3 {
        // v3: будильник «по чужому часовому поясу» — пояс события и
        // «разбудить за N минут». У старых будильников пояса нет (NULL).
        conn.execute_batch(
            "
            BEGIN;
            ALTER TABLE extra_alarms ADD COLUMN source_tz TEXT;
            ALTER TABLE extra_alarms ADD COLUMN lead_minutes INTEGER NOT NULL DEFAULT 0;
            PRAGMA user_version = 3;
            COMMIT;
            ",
        )?;
    }

    if version < 4 {
        // v4: напоминания — срочность, флажок, «выполнено», повтор и списки.
        // Старые события звонили как будильники, поэтому остаются срочными.
        conn.execute_batch(
            "
            BEGIN;
            ALTER TABLE custom_events ADD COLUMN urgent INTEGER NOT NULL DEFAULT 0;
            ALTER TABLE custom_events ADD COLUMN flagged INTEGER NOT NULL DEFAULT 0;
            ALTER TABLE custom_events ADD COLUMN completed INTEGER NOT NULL DEFAULT 0;
            ALTER TABLE custom_events ADD COLUMN repeat_rule TEXT NOT NULL DEFAULT 'Once';
            ALTER TABLE custom_events ADD COLUMN list_id TEXT;
            UPDATE custom_events SET urgent = reminder_enabled;

            CREATE TABLE IF NOT EXISTS reminder_lists (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                color TEXT NOT NULL
            );

            PRAGMA user_version = 4;
            COMMIT;
            ",
        )?;
    }

    debug_assert_eq!(SCHEMA_VERSION, 4);
    Ok(())
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

use crate::DayOverride;


/// Полностью заменяет overrides графика на переданный набор — удаляет
/// старые и записывает новые одной транзакцией. Простая и предсказуемая
/// семантика: "вот актуальный список overrides на сейчас", а не накопление.
#[uniffi::export]
pub fn save_day_overrides_ffi(
    db_path: String,
    schedule_id: Uuid,
    overrides: Vec<DayOverride>,
) -> Result<(), AlarmCoreError> {
    let conn = init_db(&db_path).map_err(|e| AlarmCoreError::DatabaseError { details: e.to_string() })?;
    let tx = conn.unchecked_transaction().map_err(|e| AlarmCoreError::DatabaseError { details: e.to_string() })?;

    tx.execute("DELETE FROM day_overrides WHERE schedule_id = ?1", [schedule_id.to_string()])
        .map_err(|e| AlarmCoreError::DatabaseError { details: e.to_string() })?;

    for o in overrides {
        tx.execute(
            "INSERT INTO day_overrides (id, schedule_id, date, is_work) VALUES (?1, ?2, ?3, ?4)",
            (
                Uuid::new_v4().to_string(),
                schedule_id.to_string(),
                o.date.to_string(),
                o.is_work,
            ),
        )
        .map_err(|e| AlarmCoreError::DatabaseError { details: e.to_string() })?;
    }

    tx.commit().map_err(|e| AlarmCoreError::DatabaseError { details: e.to_string() })?;
    Ok(())
}

/// Загружает все overrides конкретного графика.
#[uniffi::export]
pub fn load_day_overrides_ffi(db_path: String, schedule_id: Uuid) -> Result<Vec<DayOverride>, AlarmCoreError> {
    let conn = init_db(&db_path).map_err(|e| AlarmCoreError::DatabaseError { details: e.to_string() })?;
    let mut stmt = conn
        .prepare("SELECT date, is_work FROM day_overrides WHERE schedule_id = ?1")
        .map_err(|e| AlarmCoreError::DatabaseError { details: e.to_string() })?;

    let rows = stmt
        .query_map([schedule_id.to_string()], |row| {
            let date_str: String = row.get(0)?;
            let is_work: bool = row.get(1)?;
            Ok(DayOverride {
                date: date_str.parse().expect("stored date should always be valid"),
                is_work,
            })
        })
        .map_err(|e| AlarmCoreError::DatabaseError { details: e.to_string() })?;

    rows.collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| AlarmCoreError::DatabaseError { details: e.to_string() })
}

/// Вчерашняя дата (по UTC) — начало окна генерации. Берём с запасом в день,
/// чтобы разница часовых поясов не съела сегодняшний будильник; прошедшие
/// инстансы нативный синхронизатор всё равно отбрасывает.
fn window_start_today() -> chrono::NaiveDate {
    chrono::Utc::now().date_naive() - chrono::Duration::days(1)
}

/// Генерирует и объединяет предстоящие будильники всех активных графиков
/// за один вызов — мобильной стороне не нужно знать, сколько графиков есть
/// и как их правильно смешивать между собой. Окно — от вчера на
/// `horizon_months` вперёд; учитывает overrides дней и время на конкретную дату.
#[uniffi::export]
pub fn generate_upcoming_alarms_ffi(
    db_path: String,
    horizon_months: u32,
) -> Result<Vec<AlarmInstance>, AlarmCoreError> {
    generate_upcoming_alarms_from(&db_path, window_start_today(), horizon_months)
}

fn db_err(e: impl ToString) -> AlarmCoreError {
    AlarmCoreError::DatabaseError { details: e.to_string() }
}

/// То же самое, но с явным началом окна — нужно тестам.
pub fn generate_upcoming_alarms_from(
    db_path: &str,
    from: chrono::NaiveDate,
    horizon_months: u32,
) -> Result<Vec<AlarmInstance>, AlarmCoreError> {
    let conn = init_db(db_path).map_err(db_err)?;
    let schedules = load_work_schedules(&conn).map_err(db_err)?;

    let mut all_instances: Vec<AlarmInstance> = Vec::new();
    for schedule in schedules.iter().filter(|s| s.is_active) {
        let mut pairs = crate::generate_instances_from(schedule, from, horizon_months);

        let overrides = load_day_overrides_ffi(db_path.to_string(), schedule.id)?;
        let window_end = from
            .checked_add_months(chrono::Months::new(horizon_months))
            .expect("horizon slipped past chrono's supported date range");

        for o in &overrides {
            let already_has_instance = pairs.iter().any(|(i, _)| i.date == o.date);

            if o.is_work && !already_has_instance {
                // Override включает будильник там, где по паттерну был выходной.
                if o.date < from || o.date >= window_end {
                    continue;
                }
                for rule in &schedule.alarms {
                    let alarm_time = schedule.shift_start_time
                        - chrono::Duration::minutes(rule.offset_minutes as i64);
                    pairs.push((
                        AlarmInstance {
                            id: Uuid::new_v4(),
                            schedule_id: schedule.id,
                            date: o.date,
                            time_local: alarm_time,
                            status: InstanceStatus::Active,
                            origin: AlarmOrigin::ManualOverride,
                        },
                        rule.id,
                    ));
                }
            } else if !o.is_work {
                // Override выключает будильник там, где по паттерну была смена.
                pairs.retain(|(i, _)| i.date != o.date);
            }
        }

        // Время на конкретную дату: подменяем время у нужного правила.
        let time_overrides = load_alarm_time_overrides_ffi(db_path.to_string(), schedule.id)?;
        for (instance, rule_id) in pairs.iter_mut() {
            if let Some(t) = time_overrides
                .iter()
                .find(|t| t.date == instance.date && t.rule_id == *rule_id)
            {
                instance.time_local = t.time_local;
            }
        }

        all_instances.extend(pairs.into_iter().map(|(i, _)| i));
    }

    all_instances.sort_by(|a, b| (a.date, a.time_local).cmp(&(b.date, b.time_local)));

    Ok(all_instances)
}

use crate::{ExtraAlarm, ExtraAlarmInstance, ExtraAlarmKind, AlarmTimeOverride, convert_event_time};

fn kind_to_str(k: ExtraAlarmKind) -> &'static str {
    match k {
        ExtraAlarmKind::WorkDays => "work_days",
        ExtraAlarmKind::RestDays => "rest_days",
        ExtraAlarmKind::AllDays => "all_days",
        ExtraAlarmKind::OneDate => "one_date",
    }
}

fn kind_from_str(s: &str) -> ExtraAlarmKind {
    match s {
        "work_days" => ExtraAlarmKind::WorkDays,
        "rest_days" => ExtraAlarmKind::RestDays,
        "one_date" => ExtraAlarmKind::OneDate,
        _ => ExtraAlarmKind::AllDays,
    }
}

/// Сохраняет дополнительный будильник (UPSERT по id).
#[uniffi::export]
pub fn save_extra_alarm_ffi(db_path: String, alarm: ExtraAlarm) -> Result<(), AlarmCoreError> {
    let conn = init_db(&db_path).map_err(db_err)?;
    conn.execute(
        "INSERT INTO extra_alarms (id, label, time_local, kind, date, enabled, source_tz, lead_minutes)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
         ON CONFLICT(id) DO UPDATE SET
            label = excluded.label,
            time_local = excluded.time_local,
            kind = excluded.kind,
            date = excluded.date,
            enabled = excluded.enabled,
            source_tz = excluded.source_tz,
            lead_minutes = excluded.lead_minutes",
        (
            alarm.id.to_string(),
            &alarm.label,
            alarm.time_local.to_string(),
            kind_to_str(alarm.kind),
            alarm.date.map(|d| d.to_string()),
            alarm.enabled,
            &alarm.source_tz,
            alarm.lead_minutes,
        ),
    )
    .map_err(db_err)?;
    Ok(())
}

/// Загружает все дополнительные будильники.
#[uniffi::export]
pub fn load_extra_alarms_ffi(db_path: String) -> Result<Vec<ExtraAlarm>, AlarmCoreError> {
    let conn = init_db(&db_path).map_err(db_err)?;
    let mut stmt = conn
        .prepare("SELECT id, label, time_local, kind, date, enabled, source_tz, lead_minutes FROM extra_alarms ORDER BY time_local")
        .map_err(db_err)?;
    let rows = stmt
        .query_map([], |row| {
            let id_str: String = row.get(0)?;
            let time_str: String = row.get(2)?;
            let kind_str: String = row.get(3)?;
            let date_str: Option<String> = row.get(4)?;
            Ok(ExtraAlarm {
                id: id_str.parse().expect("stored id should always be valid UUID"),
                label: row.get(1)?,
                time_local: time_str.parse().expect("stored time should always be valid"),
                kind: kind_from_str(&kind_str),
                date: date_str.map(|d| d.parse().expect("stored date should always be valid")),
                enabled: row.get(5)?,
                source_tz: row.get(6)?,
                lead_minutes: row.get(7)?,
            })
        })
        .map_err(db_err)?;
    rows.collect::<rusqlite::Result<Vec<_>>>().map_err(db_err)
}

/// Удаляет дополнительный будильник.
#[uniffi::export]
pub fn delete_extra_alarm_ffi(db_path: String, alarm_id: Uuid) -> Result<(), AlarmCoreError> {
    let conn = init_db(&db_path).map_err(db_err)?;
    conn.execute("DELETE FROM extra_alarms WHERE id = ?1", [alarm_id.to_string()])
        .map_err(db_err)?;
    Ok(())
}

/// Ставит другое время для одного будильника графика в одну дату (UPSERT).
#[uniffi::export]
pub fn save_alarm_time_override_ffi(db_path: String, item: AlarmTimeOverride) -> Result<(), AlarmCoreError> {
    let conn = init_db(&db_path).map_err(db_err)?;
    conn.execute(
        "INSERT INTO alarm_time_overrides (schedule_id, date, rule_id, time_local)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(schedule_id, date, rule_id) DO UPDATE SET time_local = excluded.time_local",
        (
            item.schedule_id.to_string(),
            item.date.to_string(),
            item.rule_id.to_string(),
            item.time_local.to_string(),
        ),
    )
    .map_err(db_err)?;
    Ok(())
}

/// Загружает все "времена на дату" графика.
#[uniffi::export]
pub fn load_alarm_time_overrides_ffi(db_path: String, schedule_id: Uuid) -> Result<Vec<AlarmTimeOverride>, AlarmCoreError> {
    let conn = init_db(&db_path).map_err(db_err)?;
    let mut stmt = conn
        .prepare("SELECT date, rule_id, time_local FROM alarm_time_overrides WHERE schedule_id = ?1")
        .map_err(db_err)?;
    let rows = stmt
        .query_map([schedule_id.to_string()], |row| {
            let date_str: String = row.get(0)?;
            let rule_str: String = row.get(1)?;
            let time_str: String = row.get(2)?;
            Ok(AlarmTimeOverride {
                schedule_id,
                date: date_str.parse().expect("stored date should always be valid"),
                rule_id: rule_str.parse().expect("stored id should always be valid UUID"),
                time_local: time_str.parse().expect("stored time should always be valid"),
            })
        })
        .map_err(db_err)?;
    rows.collect::<rusqlite::Result<Vec<_>>>().map_err(db_err)
}

/// Убирает "время на дату" — будильник снова звонит по обычному правилу.
#[uniffi::export]
pub fn delete_alarm_time_override_ffi(
    db_path: String,
    schedule_id: Uuid,
    date: chrono::NaiveDate,
    rule_id: Uuid,
) -> Result<(), AlarmCoreError> {
    let conn = init_db(&db_path).map_err(db_err)?;
    conn.execute(
        "DELETE FROM alarm_time_overrides WHERE schedule_id = ?1 AND date = ?2 AND rule_id = ?3",
        (schedule_id.to_string(), date.to_string(), rule_id.to_string()),
    )
    .map_err(db_err)?;
    Ok(())
}

/// Раскладывает дополнительные будильники по датам окна. Рабочие дни —
/// по паттерну активного графика с учётом overrides; нет активного графика —
/// все дни считаются выходными.
#[uniffi::export]
pub fn generate_extra_alarms_ffi(
    db_path: String,
    horizon_months: u32,
    device_tz: String,
) -> Result<Vec<ExtraAlarmInstance>, AlarmCoreError> {
    generate_extra_alarms_from(&db_path, window_start_today(), horizon_months, &device_tz)
}

pub fn generate_extra_alarms_from(
    db_path: &str,
    from: chrono::NaiveDate,
    horizon_months: u32,
    device_tz: &str,
) -> Result<Vec<ExtraAlarmInstance>, AlarmCoreError> {
    let conn = init_db(db_path).map_err(db_err)?;
    let schedules = load_work_schedules(&conn).map_err(db_err)?;
    let alarms = load_extra_alarms_ffi(db_path.to_string())?;

    let window_end = from
        .checked_add_months(chrono::Months::new(horizon_months))
        .expect("horizon slipped past chrono's supported date range");

    // Рабочие даты окна по всем активным графикам.
    let mut work_dates: std::collections::HashSet<chrono::NaiveDate> = std::collections::HashSet::new();
    for schedule in schedules.iter().filter(|s| s.is_active) {
        let overrides = load_day_overrides_ffi(db_path.to_string(), schedule.id)?;
        let mut date = from.max(schedule.start_date);
        while date < window_end {
            let offset = (date - schedule.start_date).num_days();
            let mut is_work = crate::pattern_is_work(schedule, offset);
            if let Some(o) = overrides.iter().find(|o| o.date == date) {
                is_work = o.is_work;
            }
            if is_work {
                work_dates.insert(date);
            }
            date += chrono::Duration::days(1);
        }
    }

    let mut out = Vec::new();
    for alarm in alarms.iter().filter(|a| a.enabled) {
        if alarm.kind == ExtraAlarmKind::OneDate {
            if let Some(d) = alarm.date {
                // Будильник по чужому поясу: дату и время пересчитываем в местные.
                // Пересчёт делаем при каждой генерации, поэтому после смены пояса
                // на телефоне всё само встаёт на нужное место.
                let (day, time) = match &alarm.source_tz {
                    Some(tz) => match convert_event_time(d, alarm.time_local, tz, alarm.lead_minutes, device_tz) {
                        Ok(local) => (local.date, local.time_local),
                        Err(_) => continue, // неизвестный пояс — лучше пропустить, чем звонить не вовремя
                    },
                    None => (d, alarm.time_local),
                };
                if day >= from {
                    out.push(ExtraAlarmInstance {
                        alarm_id: alarm.id,
                        date: day,
                        time_local: time,
                        label: alarm.label.clone(),
                    });
                }
            }
            continue;
        }

        let mut date = from;
        while date < window_end {
            let is_work = work_dates.contains(&date);
            let matches = match alarm.kind {
                ExtraAlarmKind::WorkDays => is_work,
                ExtraAlarmKind::RestDays => !is_work,
                ExtraAlarmKind::AllDays => true,
                ExtraAlarmKind::OneDate => false,
            };
            if matches {
                // Серия по чужому поясу: каждый день пересчитываем отдельно
                // (летнее время и т. п. учитываются на конкретную дату).
                let (day, time) = match &alarm.source_tz {
                    Some(tz) => match convert_event_time(date, alarm.time_local, tz, alarm.lead_minutes, device_tz) {
                        Ok(local) => (local.date, local.time_local),
                        Err(_) => {
                            date += chrono::Duration::days(1);
                            continue;
                        }
                    },
                    None => (date, alarm.time_local),
                };
                if day >= from {
                    out.push(ExtraAlarmInstance {
                        alarm_id: alarm.id,
                        date: day,
                        time_local: time,
                        label: alarm.label.clone(),
                    });
                }
            }
            date += chrono::Duration::days(1);
        }
    }

    out.sort_by(|a, b| (a.date, a.time_local).cmp(&(b.date, b.time_local)));
    Ok(out)
}

use crate::CustomEvent;

fn repeat_to_str(r: crate::ReminderRepeat) -> &'static str {
    use crate::ReminderRepeat::*;
    match r {
        Once => "Once",
        Daily => "Daily",
        Weekdays => "Weekdays",
        Weekly => "Weekly",
        Monthly => "Monthly",
        Yearly => "Yearly",
    }
}

fn repeat_from_str(s: &str) -> crate::ReminderRepeat {
    use crate::ReminderRepeat::*;
    match s {
        "Daily" => Daily,
        "Weekdays" => Weekdays,
        "Weekly" => Weekly,
        "Monthly" => Monthly,
        "Yearly" => Yearly,
        _ => Once,
    }
}

const EVENT_COLUMNS: &str =
    "id, date, time_local, color, label, description, reminder_enabled, urgent, flagged, completed, repeat_rule, list_id";

fn event_from_row(row: &rusqlite::Row) -> rusqlite::Result<CustomEvent> {
    let id_str: String = row.get(0)?;
    let date_str: String = row.get(1)?;
    let time_str: String = row.get(2)?;
    let repeat_str: String = row.get(10)?;
    let list_str: Option<String> = row.get(11)?;
    Ok(CustomEvent {
        id: id_str.parse().expect("stored id should always be valid UUID"),
        date: date_str.parse().expect("stored date should always be valid"),
        time_local: time_str.parse().expect("stored time should always be valid"),
        color: row.get(3)?,
        label: row.get(4)?,
        description: row.get(5)?,
        reminder_enabled: row.get(6)?,
        urgent: row.get(7)?,
        flagged: row.get(8)?,
        completed: row.get(9)?,
        repeat: repeat_from_str(&repeat_str),
        list_id: list_str.and_then(|s| s.parse().ok()),
    })
}

/// Сохраняет новое или обновлённое событие (UPSERT по id).
#[uniffi::export]
pub fn save_custom_event_ffi(db_path: String, event: CustomEvent) -> Result<(), AlarmCoreError> {
    let conn = init_db(&db_path).map_err(|e| AlarmCoreError::DatabaseError { details: e.to_string() })?;
    conn.execute(
        "INSERT INTO custom_events
            (id, date, time_local, color, label, description, reminder_enabled,
             urgent, flagged, completed, repeat_rule, list_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
         ON CONFLICT(id) DO UPDATE SET
            date = excluded.date,
            time_local = excluded.time_local,
            color = excluded.color,
            label = excluded.label,
            description = excluded.description,
            reminder_enabled = excluded.reminder_enabled,
            urgent = excluded.urgent,
            flagged = excluded.flagged,
            completed = excluded.completed,
            repeat_rule = excluded.repeat_rule,
            list_id = excluded.list_id",
        (
            event.id.to_string(),
            event.date.to_string(),
            event.time_local.to_string(),
            &event.color,
            &event.label,
            &event.description,
            event.reminder_enabled,
            event.urgent,
            event.flagged,
            event.completed,
            repeat_to_str(event.repeat),
            event.list_id.map(|u| u.to_string()),
        ),
    )
    .map_err(|e| AlarmCoreError::DatabaseError { details: e.to_string() })?;
    Ok(())
}

/// Загружает все сохранённые события (напоминания).
#[uniffi::export]
pub fn load_custom_events_ffi(db_path: String) -> Result<Vec<CustomEvent>, AlarmCoreError> {
    let conn = init_db(&db_path).map_err(|e| AlarmCoreError::DatabaseError { details: e.to_string() })?;
    let mut stmt = conn
        .prepare(&format!("SELECT {EVENT_COLUMNS} FROM custom_events"))
        .map_err(|e| AlarmCoreError::DatabaseError { details: e.to_string() })?;
    let rows = stmt
        .query_map([], event_from_row)
        .map_err(|e| AlarmCoreError::DatabaseError { details: e.to_string() })?;
    rows.collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| AlarmCoreError::DatabaseError { details: e.to_string() })
}

/// Отмечает напоминание выполненным. Разовое уходит в «Завершено»; повторяющееся
/// переезжает на следующую дату после `done_date` и остаётся невыполненным.
#[uniffi::export]
pub fn complete_reminder_ffi(
    db_path: String,
    event_id: Uuid,
    done_date: chrono::NaiveDate,
) -> Result<(), AlarmCoreError> {
    let conn = init_db(&db_path).map_err(|e| AlarmCoreError::DatabaseError { details: e.to_string() })?;
    let event = conn
        .query_row(
            &format!("SELECT {EVENT_COLUMNS} FROM custom_events WHERE id = ?1"),
            [event_id.to_string()],
            event_from_row,
        )
        .map_err(|e| AlarmCoreError::DatabaseError { details: e.to_string() })?;

    match crate::next_repeat_date(event.date, event.repeat) {
        None => {
            conn.execute("UPDATE custom_events SET completed = 1 WHERE id = ?1", [event_id.to_string()])
                .map_err(|e| AlarmCoreError::DatabaseError { details: e.to_string() })?;
        }
        Some(mut next) => {
            let mut guard = 0;
            while next <= done_date && guard < 20_000 {
                match crate::next_repeat_date(next, event.repeat) {
                    Some(d) => next = d,
                    None => break,
                }
                guard += 1;
            }
            conn.execute(
                "UPDATE custom_events SET date = ?1 WHERE id = ?2",
                (next.to_string(), event_id.to_string()),
            )
            .map_err(|e| AlarmCoreError::DatabaseError { details: e.to_string() })?;
        }
    }
    Ok(())
}

/// Срабатывания напоминаний на `horizon_months` вперёд (с учётом повторов).
/// Окно начинается со вчерашнего дня — так же, как у будильников графиков.
#[uniffi::export]
pub fn generate_reminder_occurrences_ffi(
    db_path: String,
    horizon_months: u32,
) -> Result<Vec<crate::ReminderOccurrence>, AlarmCoreError> {
    let events = load_custom_events_ffi(db_path)?;
    let from = chrono::Utc::now().date_naive().pred_opt().expect("date in range");
    let to = from + chrono::Duration::days(31 * horizon_months as i64);
    Ok(crate::reminder_occurrences(&events, from, to))
}

use crate::ReminderList;

/// Сохраняет список напоминаний (UPSERT по id).
#[uniffi::export]
pub fn save_reminder_list_ffi(db_path: String, list: ReminderList) -> Result<(), AlarmCoreError> {
    let conn = init_db(&db_path).map_err(|e| AlarmCoreError::DatabaseError { details: e.to_string() })?;
    conn.execute(
        "INSERT INTO reminder_lists (id, name, color) VALUES (?1, ?2, ?3)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, color = excluded.color",
        (list.id.to_string(), &list.name, &list.color),
    )
    .map_err(|e| AlarmCoreError::DatabaseError { details: e.to_string() })?;
    Ok(())
}

#[uniffi::export]
pub fn load_reminder_lists_ffi(db_path: String) -> Result<Vec<ReminderList>, AlarmCoreError> {
    let conn = init_db(&db_path).map_err(|e| AlarmCoreError::DatabaseError { details: e.to_string() })?;
    let mut stmt = conn
        .prepare("SELECT id, name, color FROM reminder_lists ORDER BY rowid")
        .map_err(|e| AlarmCoreError::DatabaseError { details: e.to_string() })?;
    let rows = stmt
        .query_map([], |row| {
            let id_str: String = row.get(0)?;
            Ok(ReminderList {
                id: id_str.parse().expect("stored id should always be valid UUID"),
                name: row.get(1)?,
                color: row.get(2)?,
            })
        })
        .map_err(|e| AlarmCoreError::DatabaseError { details: e.to_string() })?;
    rows.collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| AlarmCoreError::DatabaseError { details: e.to_string() })
}

/// Удаляет список. Напоминания из него не удаляются — они переезжают в общий список.
#[uniffi::export]
pub fn delete_reminder_list_ffi(db_path: String, list_id: Uuid) -> Result<(), AlarmCoreError> {
    let conn = init_db(&db_path).map_err(|e| AlarmCoreError::DatabaseError { details: e.to_string() })?;
    conn.execute("UPDATE custom_events SET list_id = NULL WHERE list_id = ?1", [list_id.to_string()])
        .map_err(|e| AlarmCoreError::DatabaseError { details: e.to_string() })?;
    conn.execute("DELETE FROM reminder_lists WHERE id = ?1", [list_id.to_string()])
        .map_err(|e| AlarmCoreError::DatabaseError { details: e.to_string() })?;
    Ok(())
}

/// Удаляет событие по id.
#[uniffi::export]
pub fn delete_custom_event_ffi(db_path: String, event_id: Uuid) -> Result<(), AlarmCoreError> {
    let conn = init_db(&db_path).map_err(|e| AlarmCoreError::DatabaseError { details: e.to_string() })?;
    conn.execute("DELETE FROM custom_events WHERE id = ?1", [event_id.to_string()])
        .map_err(|e| AlarmCoreError::DatabaseError { details: e.to_string() })?;
    Ok(())
}

use crate::SchedulePause;

/// Сохраняет новую паузу (не UPSERT — каждая пауза уникальна по id,
/// пользователь может создать несколько непересекающихся пауз подряд).
#[uniffi::export]
pub fn save_schedule_pause_ffi(db_path: String, pause: SchedulePause) -> Result<(), AlarmCoreError> {
    let conn = init_db(&db_path).map_err(|e| AlarmCoreError::DatabaseError { details: e.to_string() })?;
    conn.execute(
        "INSERT INTO schedule_pauses (id, schedule_id, start_date, end_date, label)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        (
            pause.id.to_string(),
            pause.schedule_id.to_string(),
            pause.start_date.to_string(),
            pause.end_date.to_string(),
            &pause.label,
        ),
    )
    .map_err(|e| AlarmCoreError::DatabaseError { details: e.to_string() })?;
    Ok(())
}

/// Загружает все паузы конкретного графика.
#[uniffi::export]
pub fn load_schedule_pauses_ffi(db_path: String, schedule_id: Uuid) -> Result<Vec<SchedulePause>, AlarmCoreError> {
    let conn = init_db(&db_path).map_err(|e| AlarmCoreError::DatabaseError { details: e.to_string() })?;
    let mut stmt = conn
        .prepare("SELECT id, schedule_id, start_date, end_date, label FROM schedule_pauses WHERE schedule_id = ?1")
        .map_err(|e| AlarmCoreError::DatabaseError { details: e.to_string() })?;

    let rows = stmt
        .query_map([schedule_id.to_string()], |row| {
            let id_str: String = row.get(0)?;
            let schedule_id_str: String = row.get(1)?;
            let start_str: String = row.get(2)?;
            let end_str: String = row.get(3)?;
            Ok(SchedulePause {
                id: id_str.parse().expect("stored id should always be valid UUID"),
                schedule_id: schedule_id_str.parse().expect("stored schedule_id should always be valid UUID"),
                start_date: start_str.parse().expect("stored date should always be valid"),
                end_date: end_str.parse().expect("stored date should always be valid"),
                label: row.get(4)?,
            })
        })
        .map_err(|e| AlarmCoreError::DatabaseError { details: e.to_string() })?;

    rows.collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| AlarmCoreError::DatabaseError { details: e.to_string() })
}

/// Удаляет паузу по id. ВАЖНО: сама по себе НЕ снимает day_overrides,
/// которые были проставлены вместе с ней — это отдельный шаг на мобильной
/// стороне (загрузить overrides паузы по диапазону, убрать их).
#[uniffi::export]
pub fn delete_schedule_pause_ffi(db_path: String, pause_id: Uuid) -> Result<(), AlarmCoreError> {
    let conn = init_db(&db_path).map_err(|e| AlarmCoreError::DatabaseError { details: e.to_string() })?;
    conn.execute("DELETE FROM schedule_pauses WHERE id = ?1", [pause_id.to_string()])
        .map_err(|e| AlarmCoreError::DatabaseError { details: e.to_string() })?;
    Ok(())
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

    let instances = generate_upcoming_alarms_from(&db_path_str, NaiveDate::from_ymd_opt(2026, 1, 1).unwrap(), 1).unwrap();

    // Все инстансы должны принадлежать только активному графику
    assert!(instances.iter().all(|i| i.schedule_id == active_schedule.id));
    assert!(!instances.is_empty());

    // Список должен быть отсортирован по дате (не убывает)
    for pair in instances.windows(2) {
        assert!(pair[0].date <= pair[1].date);
    }

    std::fs::remove_file(db_path).ok();
}

#[test]
fn save_and_load_day_overrides_roundtrip() {
    let db_path = std::env::temp_dir().join(format!("test_overrides_{}.db", Uuid::new_v4()));
    let db_path_str = db_path.to_str().unwrap().to_string();

    let conn = init_db(&db_path_str).unwrap();

    let schedule = WorkSchedule {
        id: Uuid::new_v4(),
        name: "Test".to_string(),
        color: "#E8875A".to_string(),
        pattern: SchedulePattern::Custom(vec![DayType::Work, DayType::Rest]),
        source: ScheduleSource::Custom,
        start_date: NaiveDate::from_ymd_opt(2026, 1, 1).unwrap(),
        shift_start_time: NaiveTime::from_hms_opt(8, 0, 0).unwrap(),
        alarms: vec![],
        is_active: true,
        is_paused: false,
    };
    save_work_schedule(&conn, &schedule).unwrap();

    let overrides = vec![
        DayOverride { date: NaiveDate::from_ymd_opt(2026, 1, 5).unwrap(), is_work: false },
        DayOverride { date: NaiveDate::from_ymd_opt(2026, 1, 10).unwrap(), is_work: true },
    ];

    save_day_overrides_ffi(db_path_str.clone(), schedule.id, overrides.clone()).unwrap();

    let loaded = load_day_overrides_ffi(db_path_str.clone(), schedule.id).unwrap();
    assert_eq!(loaded.len(), 2);

    // Проверяем, что полная замена реально заменяет, а не накапливает —
    // второй вызов с одним override должен оставить только его.
    let replacement = vec![DayOverride {
        date: NaiveDate::from_ymd_opt(2026, 2, 1).unwrap(),
        is_work: false,
    }];
    save_day_overrides_ffi(db_path_str.clone(), schedule.id, replacement).unwrap();

    let loaded_after_replace = load_day_overrides_ffi(db_path_str, schedule.id).unwrap();
    assert_eq!(loaded_after_replace.len(), 1);
    assert_eq!(loaded_after_replace[0].date, NaiveDate::from_ymd_opt(2026, 2, 1).unwrap());

    std::fs::remove_file(db_path).ok();
}

#[test]
fn generate_upcoming_alarms_respects_day_overrides() {
    let db_path = std::env::temp_dir().join(format!("test_override_gen_{}.db", Uuid::new_v4()));
    let db_path_str = db_path.to_str().unwrap().to_string();

    let conn = init_db(&db_path_str).unwrap();

    let schedule = WorkSchedule {
        id: Uuid::new_v4(),
        name: "Test".to_string(),
        color: "#E8875A".to_string(),
        // Пн(раб)/Вт(вых) — 2-дневный цикл, стартует 1 января 2026 (четверг)
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
    save_work_schedule(&conn, &schedule).unwrap();

    // 1 января — рабочий по паттерну, 2 января — выходной по паттерну.
    // Override переворачивает оба: 1-е становится выходным, 2-е — рабочим.
    let overrides = vec![
        DayOverride { date: NaiveDate::from_ymd_opt(2026, 1, 1).unwrap(), is_work: false },
        DayOverride { date: NaiveDate::from_ymd_opt(2026, 1, 2).unwrap(), is_work: true },
    ];
    save_day_overrides_ffi(db_path_str.clone(), schedule.id, overrides).unwrap();

    let instances = generate_upcoming_alarms_from(&db_path_str, NaiveDate::from_ymd_opt(2026, 1, 1).unwrap(), 1).unwrap();

    let jan_1 = NaiveDate::from_ymd_opt(2026, 1, 1).unwrap();
    let jan_2 = NaiveDate::from_ymd_opt(2026, 1, 2).unwrap();

    // 1 января теперь выходной — будильников быть не должно
    assert!(!instances.iter().any(|i| i.date == jan_1));

    // 2 января теперь рабочий — должен появиться будильник с пометкой ManualOverride
    let jan_2_instance = instances.iter().find(|i| i.date == jan_2);
    assert!(jan_2_instance.is_some());
    assert_eq!(jan_2_instance.unwrap().origin, AlarmOrigin::ManualOverride);

    std::fs::remove_file(db_path).ok();
}

#[test]
fn save_load_delete_custom_event_roundtrip() {
    let db_path = std::env::temp_dir().join(format!("test_event_{}.db", Uuid::new_v4()));
    let db_path_str = db_path.to_str().unwrap().to_string();

    init_db(&db_path_str).unwrap();

    let event = CustomEvent {
        id: Uuid::new_v4(),
        date: NaiveDate::from_ymd_opt(2026, 10, 15).unwrap(),
        time_local: NaiveTime::from_hms_opt(8, 0, 0).unwrap(),
        color: "#B08AC7".to_string(),
        label: "День рождения дочки".to_string(),
        description: "Забрать торт, купить шарики".to_string(),
        reminder_enabled: true,
        urgent: true,
        flagged: false,
        completed: false,
        repeat: crate::ReminderRepeat::Once,
        list_id: None,
    };

    save_custom_event_ffi(db_path_str.clone(), event.clone()).unwrap();

    let loaded = load_custom_events_ffi(db_path_str.clone()).unwrap();
    assert_eq!(loaded.len(), 1);
    assert_eq!(loaded[0].label, "День рождения дочки");

    delete_custom_event_ffi(db_path_str.clone(), event.id).unwrap();

    let after_delete = load_custom_events_ffi(db_path_str).unwrap();
    assert_eq!(after_delete.len(), 0);

    std::fs::remove_file(db_path).ok();
}

#[test]
fn save_load_delete_schedule_pause_roundtrip() {
    let db_path = std::env::temp_dir().join(format!("test_pause_{}.db", Uuid::new_v4()));
    let db_path_str = db_path.to_str().unwrap().to_string();

    let conn = init_db(&db_path_str).unwrap();

    let schedule = WorkSchedule {
        id: Uuid::new_v4(),
        name: "Test".to_string(),
        color: "#E8875A".to_string(),
        pattern: SchedulePattern::Custom(vec![DayType::Work, DayType::Rest]),
        source: ScheduleSource::Custom,
        start_date: NaiveDate::from_ymd_opt(2026, 1, 1).unwrap(),
        shift_start_time: NaiveTime::from_hms_opt(8, 0, 0).unwrap(),
        alarms: vec![],
        is_active: true,
        is_paused: false,
    };
    save_work_schedule(&conn, &schedule).unwrap();

    let pause = SchedulePause {
        id: Uuid::new_v4(),
        schedule_id: schedule.id,
        start_date: NaiveDate::from_ymd_opt(2026, 10, 1).unwrap(),
        end_date: NaiveDate::from_ymd_opt(2026, 10, 14).unwrap(),
        label: "Отпуск".to_string(),
    };

    save_schedule_pause_ffi(db_path_str.clone(), pause.clone()).unwrap();

    let loaded = load_schedule_pauses_ffi(db_path_str.clone(), schedule.id).unwrap();
    assert_eq!(loaded.len(), 1);
    assert_eq!(loaded[0].label, "Отпуск");

    delete_schedule_pause_ffi(db_path_str.clone(), pause.id).unwrap();

    let after_delete = load_schedule_pauses_ffi(db_path_str, schedule.id).unwrap();
    assert_eq!(after_delete.len(), 0);

    std::fs::remove_file(db_path).ok();
}

#[test]
fn migration_keeps_old_data_and_allows_several_events_per_date() {
    use rusqlite::Connection;
    let db_path = std::env::temp_dir().join(format!("test_migr_{}.db", Uuid::new_v4()));
    let db_path_str = db_path.to_str().unwrap().to_string();

    // Имитируем старую базу (схема до миграций, user_version = 0) с живыми данными.
    {
        let old = Connection::open(&db_path).unwrap();
        old.execute_batch(
            "CREATE TABLE custom_events (
                id TEXT PRIMARY KEY, date TEXT NOT NULL UNIQUE, time_local TEXT NOT NULL,
                color TEXT NOT NULL, label TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '', reminder_enabled INTEGER NOT NULL DEFAULT 1);
             INSERT INTO custom_events VALUES
                ('11111111-1111-1111-1111-111111111111','2026-10-15','08:00:00','#fff','Старое событие','',1);",
        ).unwrap();
    }

    // Обычное открытие через init_db должно мигрировать и сохранить строку.
    let events = load_custom_events_ffi(db_path_str.clone()).unwrap();
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].label, "Старое событие");
    // Старые события звонили как будильники — остаются срочными.
    assert!(events[0].urgent);
    assert!(!events[0].completed);
    assert_eq!(events[0].repeat, crate::ReminderRepeat::Once);

    // Теперь на одну дату можно положить второе событие.
    let second = CustomEvent {
        id: Uuid::new_v4(),
        date: NaiveDate::from_ymd_opt(2026, 10, 15).unwrap(),
        time_local: NaiveTime::from_hms_opt(9, 0, 0).unwrap(),
        color: "#000".to_string(),
        label: "Второе".to_string(),
        description: String::new(),
        reminder_enabled: true,
        urgent: true,
        flagged: false,
        completed: false,
        repeat: crate::ReminderRepeat::Once,
        list_id: None,
    };
    save_custom_event_ffi(db_path_str.clone(), second).unwrap();
    assert_eq!(load_custom_events_ffi(db_path_str.clone()).unwrap().len(), 2);

    // Повторное открытие ничего не ломает и не теряет.
    assert_eq!(load_custom_events_ffi(db_path_str).unwrap().len(), 2);

    std::fs::remove_file(db_path).ok();
}

fn sample_schedule(start: NaiveDate) -> WorkSchedule {
    WorkSchedule {
        id: Uuid::new_v4(),
        name: "2/2".to_string(),
        color: "#E8875A".to_string(),
        pattern: SchedulePattern::Cyclic { work_days: 2, rest_days: 2 },
        source: ScheduleSource::Preset("cycle_2_2".to_string()),
        start_date: start,
        shift_start_time: NaiveTime::from_hms_opt(8, 0, 0).unwrap(),
        alarms: vec![AlarmRule {
            id: Uuid::new_v4(),
            offset_minutes: 30,
            ringtone_id: "default".to_string(),
            vibration: true,
        }],
        is_active: true,
        is_paused: false,
    }
}

#[test]
fn alarms_keep_coming_months_after_schedule_start() {
    let db_path = std::env::temp_dir().join(format!("test_window_{}.db", Uuid::new_v4()));
    let p = db_path.to_str().unwrap().to_string();
    let conn = init_db(&p).unwrap();

    // График начался год назад — раньше будильники кончились бы через 2 месяца.
    let schedule = sample_schedule(NaiveDate::from_ymd_opt(2025, 10, 1).unwrap());
    save_work_schedule(&conn, &schedule).unwrap();

    let from = NaiveDate::from_ymd_opt(2026, 10, 9).unwrap();
    let list = generate_upcoming_alarms_from(&p, from, 2).unwrap();
    assert!(!list.is_empty());
    assert!(list.iter().all(|i| i.date >= from));
    // Фаза цикла сохранилась: 2025-10-01 + 373 дня = 2026-10-09, 373 % 4 = 1 → рабочий.
    assert!(list.iter().any(|i| i.date == from));

    std::fs::remove_file(db_path).ok();
}

#[test]
fn time_override_changes_only_that_date() {
    let db_path = std::env::temp_dir().join(format!("test_timeov_{}.db", Uuid::new_v4()));
    let p = db_path.to_str().unwrap().to_string();
    let conn = init_db(&p).unwrap();

    let schedule = sample_schedule(NaiveDate::from_ymd_opt(2026, 1, 1).unwrap());
    save_work_schedule(&conn, &schedule).unwrap();
    let rule_id = schedule.alarms[0].id;

    // 3 января — выходной по паттерну; делаем рабочим и просим 09:15.
    let d3 = NaiveDate::from_ymd_opt(2026, 1, 3).unwrap();
    save_day_overrides_ffi(p.clone(), schedule.id, vec![DayOverride { date: d3, is_work: true }]).unwrap();
    save_alarm_time_override_ffi(p.clone(), AlarmTimeOverride {
        schedule_id: schedule.id, date: d3, rule_id,
        time_local: NaiveTime::from_hms_opt(9, 15, 0).unwrap(),
    }).unwrap();

    let list = generate_upcoming_alarms_from(&p, NaiveDate::from_ymd_opt(2026, 1, 1).unwrap(), 1).unwrap();
    let jan3 = list.iter().find(|i| i.date == d3).unwrap();
    assert_eq!(jan3.time_local, NaiveTime::from_hms_opt(9, 15, 0).unwrap());
    let jan1 = list.iter().find(|i| i.date == NaiveDate::from_ymd_opt(2026, 1, 1).unwrap()).unwrap();
    assert_eq!(jan1.time_local, NaiveTime::from_hms_opt(7, 30, 0).unwrap());

    delete_alarm_time_override_ffi(p.clone(), schedule.id, d3, rule_id).unwrap();
    let list = generate_upcoming_alarms_from(&p, NaiveDate::from_ymd_opt(2026, 1, 1).unwrap(), 1).unwrap();
    assert_eq!(
        list.iter().find(|i| i.date == d3).unwrap().time_local,
        NaiveTime::from_hms_opt(7, 30, 0).unwrap()
    );

    std::fs::remove_file(db_path).ok();
}

#[test]
fn extra_alarms_work_rest_and_stacked() {
    let db_path = std::env::temp_dir().join(format!("test_extra_{}.db", Uuid::new_v4()));
    let p = db_path.to_str().unwrap().to_string();
    let conn = init_db(&p).unwrap();

    let schedule = sample_schedule(NaiveDate::from_ymd_opt(2026, 1, 1).unwrap());
    save_work_schedule(&conn, &schedule).unwrap();

    let mk = |label: &str, h: u32, m: u32, kind, date| ExtraAlarm {
        id: Uuid::new_v4(), label: label.to_string(),
        time_local: NaiveTime::from_hms_opt(h, m, 0).unwrap(),
        kind, date, enabled: true, source_tz: None, lead_minutes: 0,
    };
    // Будильник в выходной, серия из трёх на рабочие дни и один на дату.
    save_extra_alarm_ffi(p.clone(), mk("Выходной", 9, 0, ExtraAlarmKind::RestDays, None)).unwrap();
    for (i, m) in [0u32, 5, 10].iter().enumerate() {
        save_extra_alarm_ffi(p.clone(), mk(&format!("Серия {}", i + 1), 6, *m, ExtraAlarmKind::WorkDays, None)).unwrap();
    }
    let d = NaiveDate::from_ymd_opt(2026, 1, 3).unwrap();
    save_extra_alarm_ffi(p.clone(), mk("Разовый", 11, 0, ExtraAlarmKind::OneDate, Some(d))).unwrap();

    let from = NaiveDate::from_ymd_opt(2026, 1, 1).unwrap();
    let list = generate_extra_alarms_from(&p, from, 1, "Europe/Moscow").unwrap();

    let on = |day: u32| -> Vec<&str> {
        list.iter()
            .filter(|i| i.date == NaiveDate::from_ymd_opt(2026, 1, day).unwrap())
            .map(|i| i.label.as_str())
            .collect()
    };
    // 1 и 2 января — рабочие: три серийных; 3 и 4 — выходные: «Выходной», 3-го ещё «Разовый».
    assert_eq!(on(1), vec!["Серия 1", "Серия 2", "Серия 3"]);
    assert_eq!(on(3), vec!["Выходной", "Разовый"]);
    assert_eq!(on(4), vec!["Выходной"]);

    // Отключённый будильник не попадает в выдачу.
    let mut off = mk("Выкл", 5, 0, ExtraAlarmKind::AllDays, None);
    off.enabled = false;
    save_extra_alarm_ffi(p.clone(), off).unwrap();
    let list2 = generate_extra_alarms_from(&p, from, 1, "Europe/Moscow").unwrap();
    assert!(!list2.iter().any(|i| i.label == "Выкл"));

    std::fs::remove_file(db_path).ok();
}

#[test]
fn timezone_event_alarm_converts_and_survives_dst() {
    use crate::convert_event_time;
    let d = |y, m, day| NaiveDate::from_ymd_opt(y, m, day).unwrap();
    let t = |h, m| NaiveTime::from_hms_opt(h, m, 0).unwrap();

    // Екатеринбург (+5) -> Москва (+3): на два часа раньше.
    let r = convert_event_time(d(2026, 10, 20), t(10, 0), "Asia/Yekaterinburg", 0, "Europe/Moscow").unwrap();
    assert_eq!((r.date, r.time_local), (d(2026, 10, 20), t(8, 0)));

    // «Разбудить за 60 минут» отнимается от пересчитанного времени.
    let r = convert_event_time(d(2026, 10, 20), t(10, 0), "Asia/Yekaterinburg", 60, "Europe/Moscow").unwrap();
    assert_eq!((r.date, r.time_local), (d(2026, 10, 20), t(7, 0)));

    // Переход через полночь: 01:00 в Екатеринбурге это 23:00 предыдущего дня в Москве.
    let r = convert_event_time(d(2026, 10, 20), t(1, 0), "Asia/Yekaterinburg", 0, "Europe/Moscow").unwrap();
    assert_eq!((r.date, r.time_local), (d(2026, 10, 19), t(23, 0)));

    // Нью-Йорк переводит стрелки: 12 марта 2027 ещё зима (UTC-5), 15 марта уже лето (UTC-4).
    let winter = convert_event_time(d(2027, 3, 12), t(9, 0), "America/New_York", 0, "Europe/Moscow").unwrap();
    let summer = convert_event_time(d(2027, 3, 15), t(9, 0), "America/New_York", 0, "Europe/Moscow").unwrap();
    assert_eq!(winter.time_local, t(17, 0));
    assert_eq!(summer.time_local, t(16, 0));

    // Той же встрече достаточно смены пояса телефона: в Екатеринбурге это 18:00.
    let moved = convert_event_time(d(2026, 10, 20), t(10, 0), "Asia/Yekaterinburg", 0, "Asia/Yekaterinburg").unwrap();
    assert_eq!(moved.time_local, t(10, 0));

    // «Дыра» при переводе стрелок вперёд (02:30 в Нью-Йорке 14 марта 2027) не паникует.
    assert!(convert_event_time(d(2027, 3, 14), t(2, 30), "America/New_York", 0, "Europe/Moscow").is_ok());

    // Неизвестный пояс — ошибка, а не паника.
    assert!(convert_event_time(d(2026, 10, 20), t(10, 0), "Mars/Olympus", 0, "Europe/Moscow").is_err());
}

#[test]
fn timezone_alarm_follows_device_timezone_and_migrates() {
    let db_path = std::env::temp_dir().join(format!("test_tz_{}.db", Uuid::new_v4()));
    let p = db_path.to_str().unwrap().to_string();

    // База версии 2 (до часовых поясов) с обычным будильником: должна пережить миграцию.
    {
        let old = Connection::open(&db_path).unwrap();
        old.execute_batch(
            "CREATE TABLE work_schedules (id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT, pattern_json TEXT NOT NULL,
                source_json TEXT NOT NULL, start_date TEXT NOT NULL, shift_start_time TEXT NOT NULL,
                alarms_json TEXT NOT NULL, is_active INTEGER DEFAULT 1, is_paused INTEGER DEFAULT 0);
             CREATE TABLE extra_alarms (id TEXT PRIMARY KEY, label TEXT NOT NULL DEFAULT '', time_local TEXT NOT NULL,
                kind TEXT NOT NULL, date TEXT, enabled INTEGER NOT NULL DEFAULT 1);
             INSERT INTO extra_alarms VALUES ('22222222-2222-2222-2222-222222222222','Старый','07:30:00','all_days',NULL,1);
             PRAGMA user_version = 2;",
        ).unwrap();
    }
    let loaded = load_extra_alarms_ffi(p.clone()).unwrap();
    assert_eq!(loaded.len(), 1);
    assert_eq!(loaded[0].label, "Старый");
    assert!(loaded[0].source_tz.is_none());
    assert_eq!(loaded[0].lead_minutes, 0);

    // Встреча 10:00 по Екатеринбургу на 20 октября 2026.
    let meeting = ExtraAlarm {
        id: Uuid::new_v4(), label: "Встреча".to_string(),
        time_local: NaiveTime::from_hms_opt(10, 0, 0).unwrap(),
        kind: ExtraAlarmKind::OneDate,
        date: Some(NaiveDate::from_ymd_opt(2026, 10, 20).unwrap()),
        enabled: true,
        source_tz: Some("Asia/Yekaterinburg".to_string()), lead_minutes: 30,
    };
    save_extra_alarm_ffi(p.clone(), meeting.clone()).unwrap();

    let from = NaiveDate::from_ymd_opt(2026, 10, 19).unwrap();
    let find = |list: &Vec<ExtraAlarmInstance>| {
        list.iter().find(|i| i.label == "Встреча").map(|i| (i.date, i.time_local)).unwrap()
    };

    // Телефон в Москве: 10:00 Екб = 08:00 МСК, минус 30 минут = 07:30.
    let msk = generate_extra_alarms_from(&p, from, 1, "Europe/Moscow").unwrap();
    assert_eq!(find(&msk), (NaiveDate::from_ymd_opt(2026, 10, 20).unwrap(), NaiveTime::from_hms_opt(7, 30, 0).unwrap()));

    // Тот же будильник после перелёта в Екатеринбург: 09:30 по местным часам.
    let ekb = generate_extra_alarms_from(&p, from, 1, "Asia/Yekaterinburg").unwrap();
    assert_eq!(find(&ekb), (NaiveDate::from_ymd_opt(2026, 10, 20).unwrap(), NaiveTime::from_hms_opt(9, 30, 0).unwrap()));

    // Сохранённые данные остаются в поясе события, ничего не «портится».
    let stored = load_extra_alarms_ffi(p.clone()).unwrap();
    let m = stored.iter().find(|a| a.label == "Встреча").unwrap();
    assert_eq!(m.time_local, NaiveTime::from_hms_opt(10, 0, 0).unwrap());
    assert_eq!(m.source_tz.as_deref(), Some("Asia/Yekaterinburg"));

    std::fs::remove_file(db_path).ok();
}

#[test]
fn recurring_alarm_with_foreign_timezone() {
    let db_path = std::env::temp_dir().join(format!("test_extra_tz_rec_{}.db", Uuid::new_v4()));
    let p = db_path.to_str().unwrap().to_string();
    let _conn = init_db(&p).unwrap();

    // Каждый день в 05:00 по Екатеринбургу = 03:00 по Москве.
    let alarm = ExtraAlarm {
        id: Uuid::new_v4(), label: "Серия".to_string(),
        time_local: NaiveTime::from_hms_opt(5, 0, 0).unwrap(),
        kind: ExtraAlarmKind::AllDays, date: None, enabled: true,
        source_tz: Some("Asia/Yekaterinburg".to_string()), lead_minutes: 0,
    };
    save_extra_alarm_ffi(p.clone(), alarm).unwrap();

    let from = NaiveDate::from_ymd_opt(2026, 10, 19).unwrap();
    let list = generate_extra_alarms_from(&p, from, 1, "Europe/Moscow").unwrap();
    assert!(list.len() >= 28);
    assert!(list.iter().all(|i| i.time_local == NaiveTime::from_hms_opt(3, 0, 0).unwrap()));
    assert_eq!(list[0].date, from);

    std::fs::remove_file(db_path).ok();
}

#[cfg(test)]
fn reminder(date: (i32, u32, u32), time: (u32, u32), repeat: crate::ReminderRepeat, urgent: bool) -> CustomEvent {
    CustomEvent {
        id: Uuid::new_v4(),
        date: NaiveDate::from_ymd_opt(date.0, date.1, date.2).unwrap(),
        time_local: NaiveTime::from_hms_opt(time.0, time.1, 0).unwrap(),
        color: "#fff".to_string(),
        label: "R".to_string(),
        description: String::new(),
        reminder_enabled: true,
        urgent,
        flagged: false,
        completed: false,
        repeat,
        list_id: None,
    }
}

#[test]
fn next_repeat_date_rules() {
    use crate::{next_repeat_date, ReminderRepeat::*};
    let d = |y, m, dd| NaiveDate::from_ymd_opt(y, m, dd).unwrap();
    assert_eq!(next_repeat_date(d(2026, 10, 15), Once), None);
    assert_eq!(next_repeat_date(d(2026, 10, 15), Daily), Some(d(2026, 10, 16)));
    assert_eq!(next_repeat_date(d(2026, 10, 15), Weekly), Some(d(2026, 10, 22)));
    // пятница -> понедельник
    assert_eq!(next_repeat_date(d(2026, 10, 16), Weekdays), Some(d(2026, 10, 19)));
    assert_eq!(next_repeat_date(d(2026, 10, 14), Weekdays), Some(d(2026, 10, 15)));
    // конец месяца прижимается
    assert_eq!(next_repeat_date(d(2026, 1, 31), Monthly), Some(d(2026, 2, 28)));
    assert_eq!(next_repeat_date(d(2028, 2, 29), Yearly), Some(d(2029, 2, 28)));
}

#[test]
fn occurrences_expand_repeats_and_skip_done() {
    use crate::{reminder_occurrences, ReminderRepeat::*};
    let d = |y, m, dd| NaiveDate::from_ymd_opt(y, m, dd).unwrap();

    let once = reminder((2026, 10, 20), (9, 0), Once, false);
    let daily = reminder((2026, 10, 10), (7, 30), Daily, true); // начало в прошлом
    let mut done = reminder((2026, 10, 21), (9, 0), Once, false);
    done.completed = true;
    let mut off = reminder((2026, 10, 22), (9, 0), Once, false);
    off.reminder_enabled = false;

    let occ = reminder_occurrences(&[once.clone(), daily.clone(), done, off], d(2026, 10, 18), d(2026, 10, 22));
    // daily: 18,19,20,21,22 (5) + once 20 (1)
    assert_eq!(occ.len(), 6);
    assert!(occ.iter().all(|o| o.date >= d(2026, 10, 18) && o.date <= d(2026, 10, 22)));
    assert_eq!(occ.iter().filter(|o| o.event_id == once.id).count(), 1);
    assert_eq!(occ.iter().filter(|o| o.event_id == daily.id && o.urgent).count(), 5);
    // отсортировано по дате и времени
    assert!(occ.windows(2).all(|w| (w[0].date, w[0].time_local) <= (w[1].date, w[1].time_local)));
}

#[test]
fn complete_once_and_repeating() {
    use crate::ReminderRepeat::*;
    let db_path = std::env::temp_dir().join(format!("test_complete_{}.db", Uuid::new_v4()));
    let p = db_path.to_str().unwrap().to_string();
    let d = |y, m, dd| NaiveDate::from_ymd_opt(y, m, dd).unwrap();

    let once = reminder((2026, 10, 15), (9, 0), Once, false);
    let daily = reminder((2026, 10, 15), (9, 0), Daily, true);
    save_custom_event_ffi(p.clone(), once.clone()).unwrap();
    save_custom_event_ffi(p.clone(), daily.clone()).unwrap();

    complete_reminder_ffi(p.clone(), once.id, d(2026, 10, 15)).unwrap();
    complete_reminder_ffi(p.clone(), daily.id, d(2026, 10, 15)).unwrap();

    let loaded = load_custom_events_ffi(p.clone()).unwrap();
    let o = loaded.iter().find(|e| e.id == once.id).unwrap();
    let r = loaded.iter().find(|e| e.id == daily.id).unwrap();
    assert!(o.completed);
    assert!(!r.completed);
    assert_eq!(r.date, d(2026, 10, 16));

    // отмечено с опозданием на 3 дня: уезжает на первую дату ПОСЛЕ дня выполнения
    complete_reminder_ffi(p.clone(), daily.id, d(2026, 10, 19)).unwrap();
    let r = load_custom_events_ffi(p.clone()).unwrap().into_iter().find(|e| e.id == daily.id).unwrap();
    assert_eq!(r.date, d(2026, 10, 20));

    std::fs::remove_file(db_path).ok();
}

#[test]
fn reminder_lists_crud_and_delete_detaches_reminders() {
    use crate::ReminderRepeat::Once;
    let db_path = std::env::temp_dir().join(format!("test_lists_{}.db", Uuid::new_v4()));
    let p = db_path.to_str().unwrap().to_string();

    let work = crate::ReminderList { id: Uuid::new_v4(), name: "Работа".into(), color: "#4A90D9".into() };
    let home = crate::ReminderList { id: Uuid::new_v4(), name: "Дом".into(), color: "#E8A33D".into() };
    save_reminder_list_ffi(p.clone(), work.clone()).unwrap();
    save_reminder_list_ffi(p.clone(), home.clone()).unwrap();

    let mut ev = reminder((2026, 10, 15), (9, 0), Once, false);
    ev.list_id = Some(work.id);
    ev.flagged = true;
    save_custom_event_ffi(p.clone(), ev.clone()).unwrap();

    let lists = load_reminder_lists_ffi(p.clone()).unwrap();
    assert_eq!(lists.len(), 2);
    assert_eq!(lists[0].name, "Работа"); // порядок создания

    let loaded = load_custom_events_ffi(p.clone()).unwrap();
    assert_eq!(loaded[0].list_id, Some(work.id));
    assert!(loaded[0].flagged);

    delete_reminder_list_ffi(p.clone(), work.id).unwrap();
    assert_eq!(load_reminder_lists_ffi(p.clone()).unwrap().len(), 1);
    let loaded = load_custom_events_ffi(p.clone()).unwrap();
    assert_eq!(loaded.len(), 1); // напоминание осталось
    assert_eq!(loaded[0].list_id, None);

    std::fs::remove_file(db_path).ok();
}

#[test]
fn migration_v3_to_v4_keeps_events_and_makes_them_urgent() {
    use rusqlite::Connection;
    let db_path = std::env::temp_dir().join(format!("test_v3v4_{}.db", Uuid::new_v4()));
    let p = db_path.to_str().unwrap().to_string();
    {
        // база версии 3 (после v2/v3, до напоминаний)
        let c = Connection::open(&db_path).unwrap();
        c.execute_batch(
            "CREATE TABLE custom_events (
                id TEXT PRIMARY KEY, date TEXT NOT NULL, time_local TEXT NOT NULL,
                color TEXT NOT NULL, label TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '', reminder_enabled INTEGER NOT NULL DEFAULT 1);
             INSERT INTO custom_events VALUES
                ('11111111-1111-1111-1111-111111111111','2026-10-15','08:00:00','#fff','Звонил','',1),
                ('22222222-2222-2222-2222-222222222222','2026-10-16','09:00:00','#fff','Молчал','',0);
             CREATE TABLE extra_alarms (id TEXT PRIMARY KEY, label TEXT NOT NULL DEFAULT '', time_local TEXT NOT NULL,
                kind TEXT NOT NULL, date TEXT, enabled INTEGER NOT NULL DEFAULT 1, source_tz TEXT,
                lead_minutes INTEGER NOT NULL DEFAULT 0);
             PRAGMA user_version = 3;",
        )
        .unwrap();
    }
    let events = load_custom_events_ffi(p).unwrap();
    assert_eq!(events.len(), 2);
    let rang = events.iter().find(|e| e.label == "Звонил").unwrap();
    let quiet = events.iter().find(|e| e.label == "Молчал").unwrap();
    assert!(rang.urgent && rang.reminder_enabled);
    assert!(!quiet.urgent && !quiet.reminder_enabled);
    std::fs::remove_file(db_path).ok();
}
}
