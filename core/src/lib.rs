pub mod storage;
uniffi::setup_scaffolding!();
use chrono::{NaiveDate, NaiveTime};
use chrono::Datelike;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Тип дня в графике — рабочий, выходной или ночная смена.
/// Нужен и для кастомных графиков (Custom(Vec<DayType>)), и для
/// отображения в календаре (какой цвет/иконку показать на конкретный день).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, uniffi::Enum)]
pub enum DayType {
    Work,
    Rest,
    NightShift,
}

/// Паттерн графика — три принципиально разных способа задать расписание.
/// Это как раз то, что различает пресет 2/2 от кастомного графика
/// от "рандомного по приколу" (п.4.1 ТЗ).
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Enum)]
pub enum SchedulePattern {
    Cyclic { work_days: u8, rest_days: u8 },
    Custom(Vec<DayType>),
}

/// Источник графика — чтобы отличать "взял готовый пресет 2/2"
/// от "накидал свой график руками" (п.4.1 ТЗ, визуальные бейджи).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, uniffi::Enum)]
pub enum ScheduleSource {
    Preset(String), // id пресета, например "cycle_2_2"
    Custom,
}

/// Правило будильника внутри графика — может быть несколько на одну смену
/// (например: "за 2 часа до смены" + "за 30 минут до смены").
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Record)]
pub struct AlarmRule {
    pub id: Uuid,
    pub offset_minutes: i32, // за сколько минут до смены будить
    pub ringtone_id: String,
    pub vibration: bool,
}

/// Сам график работы — центральная сущность приложения.
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Record)]
pub struct WorkSchedule {
    pub id: Uuid,
    pub name: String,
    pub color: String,
    pub pattern: SchedulePattern,
    pub source: ScheduleSource,
    pub start_date: NaiveDate,
    pub shift_start_time: NaiveTime,
    pub alarms: Vec<AlarmRule>,
    pub is_active: bool,
    pub is_paused: bool,
}

/// Статус конкретного экземпляра будильника на конкретную дату.
/// Разница Active/SkippedByUser — это и есть механика "отключить,
/// но не удалить", которую ты просил в самом начале.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, uniffi::Enum)]
pub enum InstanceStatus {
    Active,
    SkippedByUser,
    Fired,
    Missed,
}

/// Откуда взялся этот конкретный будильник — из обычного паттерна графика,
/// вручную переопределён пользователем, или это timezone-будильник (п.4.2).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, uniffi::Enum)]
pub enum AlarmOrigin {
    FromPattern,
    ManualOverride,
    TimezoneMeeting,
}

/// Конкретный будильник на конкретную дату — то, что реально видно
/// в календаре и что реально сработает (или не сработает, если Skipped).
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Record)]
pub struct AlarmInstance {
    pub id: Uuid,
    pub schedule_id: Uuid, // ссылка на WorkSchedule, который его породил
    pub date: NaiveDate,
    pub time_local: NaiveTime,
    pub status: InstanceStatus,
    pub origin: AlarmOrigin,
}

uniffi::custom_type!(Uuid, String);

impl UniffiCustomTypeConverter for Uuid {
    type Builtin = String;

    fn into_custom(val: Self::Builtin) -> uniffi::Result<Self> {
        Ok(Uuid::parse_str(&val)?)
    }

    fn from_custom(obj: Self) -> Self::Builtin {
        obj.to_string()
    }
}

uniffi::custom_type!(NaiveDate, String);

impl UniffiCustomTypeConverter for NaiveDate {
    type Builtin = String;

    fn into_custom(val: Self::Builtin) -> uniffi::Result<Self> {
        Ok(val.parse()?)
    }

    fn from_custom(obj: Self) -> Self::Builtin {
        obj.to_string()
    }
}

uniffi::custom_type!(NaiveTime, String);

impl UniffiCustomTypeConverter for NaiveTime {
    type Builtin = String;

    fn into_custom(val: Self::Builtin) -> uniffi::Result<Self> {
        Ok(val.parse()?)
    }

    fn from_custom(obj: Self) -> Self::Builtin {
        obj.to_string()
    }
}


    /// Ошибки, которые могут вернуть FFI-функции ядра. Отдельный enum вместо
    /// голого String — потому что uniffi умеет превращать error-enum в настоящее
    /// исключение на стороне Kotlin, а строку — нет (её пришлось бы парсить руками).
#[derive(Debug, thiserror::Error, uniffi::Error)]
    pub enum AlarmCoreError {
    #[error("instance {id} not found")]
    InstanceNotFound { id: String },
}

/// Генерирует конкретные будильники (AlarmInstance) из графика на заданный
/// горизонт вперёд. Пока обрабатывает только Cyclic-паттерн (2/2, 5/2 и т.д.) —
/// Custom и Random добавим отдельно, это разная логика.
pub fn generate_instances(
    schedule: &WorkSchedule,
    horizon_months: u32,
) -> Vec<AlarmInstance> {
    let mut instances = Vec::new();

    // Считаем горизонт ОДИН раз, до match — он нужен и Cyclic, и Custom веткам
    let end_date = schedule
        .start_date
        .checked_add_months(chrono::Months::new(horizon_months))
        .expect("horizon slipped past chrono's supported date range");
    let horizon_days = (end_date - schedule.start_date).num_days();

    match &schedule.pattern {
        SchedulePattern::Cyclic { work_days, rest_days } => {
            let cycle_len = (*work_days + *rest_days) as i64;
            let mut day_offset: i64 = 0;

            while day_offset < horizon_days {
                let day_in_cycle = day_offset % cycle_len;
                let is_work_day = day_in_cycle < *work_days as i64;

                if is_work_day {
                    for rule in &schedule.alarms {
                        let alarm_time = schedule.shift_start_time
                            - chrono::Duration::minutes(rule.offset_minutes as i64);

                        instances.push(AlarmInstance {
                            id: Uuid::new_v4(),
                            schedule_id: schedule.id,
                            date: schedule.start_date + chrono::Duration::days(day_offset),
                            time_local: alarm_time,
                            status: InstanceStatus::Active,
                            origin: AlarmOrigin::FromPattern,
                        });
                    }
                }

                day_offset += 1;
            }
        }
        SchedulePattern::Custom(days) => {
            let cycle_len = days.len() as i64;
            let mut day_offset: i64 = 0;

            while day_offset < horizon_days {
                let day_in_cycle = (day_offset % cycle_len) as usize;
                let is_work_day = days[day_in_cycle] != DayType::Rest;

                if is_work_day {
                    for rule in &schedule.alarms {
                        let alarm_time = schedule.shift_start_time
                            - chrono::Duration::minutes(rule.offset_minutes as i64);

                        instances.push(AlarmInstance {
                            id: Uuid::new_v4(),
                            schedule_id: schedule.id,
                            date: schedule.start_date + chrono::Duration::days(day_offset),
                            time_local: alarm_time,
                            status: InstanceStatus::Active,
                            origin: AlarmOrigin::FromPattern,
                        });
                    }
                }

                day_offset += 1;
            }
        }
    }

    instances
}

use chrono::{DateTime, TimeZone};
use chrono_tz::Tz;

/// Пересчитывает время события, заданное в одном часовом поясе,
/// в локальное время устройства. Это и есть "будильник по чужому времени"
/// из п.4.2 ТЗ — без ручного пересчёта разницы поясов пользователем.
pub fn resolve_timezone_alarm(
    input_time: NaiveTime,
    reference_date: NaiveDate,
    source_tz: Tz,
    device_tz: Tz,
) -> DateTime<Tz> {
    let naive_dt = reference_date.and_time(input_time);

    let source_dt = source_tz
        .from_local_datetime(&naive_dt)
        .single()
        .expect("ambiguous or non-existent local time in source timezone");

    source_dt.with_timezone(&device_tz)
}

/// FFI-обёртка над resolve_timezone_alarm для вызова из Kotlin/RN.
/// Часовые пояса передаются как IANA-строки (например "Europe/Moscow",
/// "Asia/Yekaterinburg"), результат возвращается в формате "HH:MM".
#[uniffi::export]
pub fn resolve_timezone_alarm_ffi(
    input_time: NaiveTime,
    reference_date: NaiveDate,
    source_tz_name: String,
    device_tz_name: String,
) -> String {
    let source_tz: Tz = source_tz_name
        .parse()
        .expect("invalid IANA timezone name for source_tz_name");
    let device_tz: Tz = device_tz_name
        .parse()
        .expect("invalid IANA timezone name for device_tz_name");

    let resolved = resolve_timezone_alarm(input_time, reference_date, source_tz, device_tz);

    resolved.format("%H:%M").to_string()
}

#[uniffi::export]
/// Переключает статус конкретного будильника: Active <-> SkippedByUser.
/// Принимает список инстансов и возвращает НОВЫЙ список с обновлённым
/// статусом — FFI-граница всегда копирует данные, "изменить на месте
/// по ссылке" через неё невозможно (Kotlin/RN не имеют доступа к памяти Rust).
pub fn toggle_instance(
    mut instances: Vec<AlarmInstance>,
    instance_id: Uuid,
    active: bool,
) -> Result<Vec<AlarmInstance>, AlarmCoreError> {
    let instance = instances
        .iter_mut()
        .find(|i| i.id == instance_id)
        .ok_or_else(|| AlarmCoreError::InstanceNotFound { id: instance_id.to_string() })?;

    instance.status = if active {
        InstanceStatus::Active
    } else {
        InstanceStatus::SkippedByUser
    };

    Ok(instances)
}

#[uniffi::export]
/// Массово переключает статус всех будильников за указанный месяц/год.
/// Возвращает обновлённый список инстансов целиком (см. toggle_instance
/// про то, почему не &mut).
pub fn toggle_month(
    mut instances: Vec<AlarmInstance>,
    year: i32,
    month: u32,
    schedule_id: Option<Uuid>,
    active: bool,
) -> Vec<AlarmInstance> {
    for instance in instances.iter_mut() {
        let date_matches = instance.date.year() == year && instance.date.month() == month;
        let schedule_matches = schedule_id.map_or(true, |id| instance.schedule_id == id);

        if date_matches && schedule_matches {
            instance.status = if active {
                InstanceStatus::Active
            } else {
                InstanceStatus::SkippedByUser
            };
        }
    }

    instances
}


//ТЕСТ
#[cfg(test)]
mod tests {
    use super::*;
    use chrono::NaiveDate;

    #[test]
    fn cyclic_2_2_generates_correct_work_days() {
        let schedule = WorkSchedule {
            id: Uuid::new_v4(),
            name: "Test 2/2".to_string(),
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

        let instances = generate_instances(&schedule, 1);

        let jan_1 = NaiveDate::from_ymd_opt(2026, 1, 1).unwrap();
        let jan_2 = NaiveDate::from_ymd_opt(2026, 1, 2).unwrap();
        let jan_3 = NaiveDate::from_ymd_opt(2026, 1, 3).unwrap();
        let jan_4 = NaiveDate::from_ymd_opt(2026, 1, 4).unwrap();

        assert!(instances.iter().any(|i| i.date == jan_1));
        assert!(instances.iter().any(|i| i.date == jan_2));
        assert!(!instances.iter().any(|i| i.date == jan_3));
        assert!(!instances.iter().any(|i| i.date == jan_4));

        let first = instances.iter().find(|i| i.date == jan_1).unwrap();
        assert_eq!(first.time_local, NaiveTime::from_hms_opt(7, 30, 0).unwrap());
    }

    #[test]
fn yekaterinburg_meeting_resolves_to_moscow_time() {
    use chrono_tz::Asia::Yekaterinburg;
    use chrono_tz::Europe::Moscow;

    let meeting_time = NaiveTime::from_hms_opt(10, 0, 0).unwrap();
    let date = NaiveDate::from_ymd_opt(2026, 3, 10).unwrap();

    let resolved = resolve_timezone_alarm(meeting_time, date, Yekaterinburg, Moscow);

    // Екатеринбург UTC+5, Москва UTC+3 → разница 2 часа
    assert_eq!(resolved.time(), NaiveTime::from_hms_opt(8, 0, 0).unwrap());
    assert_eq!(resolved.date_naive(), date); // разница в 2 часа не переносит на другой день
}

#[test]
fn toggle_instance_changes_status_by_id() {
    let instances = vec![
        AlarmInstance {
            id: Uuid::new_v4(),
            schedule_id: Uuid::new_v4(),
            date: NaiveDate::from_ymd_opt(2026, 1, 1).unwrap(),
            time_local: NaiveTime::from_hms_opt(7, 0, 0).unwrap(),
            status: InstanceStatus::Active,
            origin: AlarmOrigin::FromPattern,
        },
        AlarmInstance {
            id: Uuid::new_v4(),
            schedule_id: Uuid::new_v4(),
            date: NaiveDate::from_ymd_opt(2026, 1, 2).unwrap(),
            time_local: NaiveTime::from_hms_opt(7, 0, 0).unwrap(),
            status: InstanceStatus::Active,
            origin: AlarmOrigin::FromPattern,
        },
    ];
    let target_id = instances[0].id;
    let other_id = instances[1].id;

    let instances = toggle_instance(instances, target_id, false).unwrap();

    assert_eq!(
        instances.iter().find(|i| i.id == target_id).unwrap().status,
        InstanceStatus::SkippedByUser
    );
    assert_eq!(
        instances.iter().find(|i| i.id == other_id).unwrap().status,
        InstanceStatus::Active
    );

    let instances = toggle_instance(instances, target_id, true).unwrap();
    assert_eq!(
        instances.iter().find(|i| i.id == target_id).unwrap().status,
        InstanceStatus::Active
    );
}

#[test]
fn toggle_month_disables_only_matching_month_and_schedule() {
    let schedule_a = Uuid::new_v4();
    let schedule_b = Uuid::new_v4();

    let instances = vec![
        AlarmInstance {
            id: Uuid::new_v4(),
            schedule_id: schedule_a,
            date: NaiveDate::from_ymd_opt(2026, 1, 10).unwrap(),
            time_local: NaiveTime::from_hms_opt(7, 0, 0).unwrap(),
            status: InstanceStatus::Active,
            origin: AlarmOrigin::FromPattern,
        },
        AlarmInstance {
            id: Uuid::new_v4(),
            schedule_id: schedule_b,
            date: NaiveDate::from_ymd_opt(2026, 1, 15).unwrap(),
            time_local: NaiveTime::from_hms_opt(7, 0, 0).unwrap(),
            status: InstanceStatus::Active,
            origin: AlarmOrigin::FromPattern,
        },
        AlarmInstance {
            id: Uuid::new_v4(),
            schedule_id: schedule_a,
            date: NaiveDate::from_ymd_opt(2026, 2, 5).unwrap(),
            time_local: NaiveTime::from_hms_opt(7, 0, 0).unwrap(),
            status: InstanceStatus::Active,
            origin: AlarmOrigin::FromPattern,
        },
    ];

    let instances = toggle_month(instances, 2026, 1, Some(schedule_a), false);

    assert_eq!(instances[0].status, InstanceStatus::SkippedByUser); // январь, A
    assert_eq!(instances[1].status, InstanceStatus::Active);        // январь, B — не тронут
    assert_eq!(instances[2].status, InstanceStatus::Active);        // февраль, A — не тронут
}

#[test]
fn toggle_month_without_schedule_filter_affects_all_schedules() {
    let instances = vec![
        AlarmInstance {
            id: Uuid::new_v4(),
            schedule_id: Uuid::new_v4(),
            date: NaiveDate::from_ymd_opt(2026, 3, 1).unwrap(),
            time_local: NaiveTime::from_hms_opt(7, 0, 0).unwrap(),
            status: InstanceStatus::Active,
            origin: AlarmOrigin::FromPattern,
        },
        AlarmInstance {
            id: Uuid::new_v4(),
            schedule_id: Uuid::new_v4(),
            date: NaiveDate::from_ymd_opt(2026, 3, 20).unwrap(),
            time_local: NaiveTime::from_hms_opt(7, 0, 0).unwrap(),
            status: InstanceStatus::Active,
            origin: AlarmOrigin::FromPattern,
        },
    ];

    let instances = toggle_month(instances, 2026, 3, None, false);

    assert!(instances.iter().all(|i| i.status == InstanceStatus::SkippedByUser));
}

#[test]
fn toggle_instance_errors_on_unknown_id() {
    let instances: Vec<AlarmInstance> = vec![];
    let result = toggle_instance(instances, Uuid::new_v4(), false);
    assert!(result.is_err());
}

    #[test]
    fn custom_pattern_respects_day_types() {
        let schedule = WorkSchedule {
            id: Uuid::new_v4(),
            name: "Test Custom".to_string(),
            color: "#00FF00".to_string(),
            pattern: SchedulePattern::Custom(vec![
                DayType::Work,
                DayType::Rest,
                DayType::NightShift,
                DayType::Rest,
            ]),
            source: ScheduleSource::Custom,
            start_date: NaiveDate::from_ymd_opt(2026, 1, 1).unwrap(),
            shift_start_time: NaiveTime::from_hms_opt(9, 0, 0).unwrap(),
            alarms: vec![AlarmRule {
                id: Uuid::new_v4(),
                offset_minutes: 0,
                ringtone_id: "default".to_string(),
                vibration: true,
            }],
            is_active: true,
            is_paused: false,
        };

        let instances = generate_instances(&schedule, 1);

        let jan_1 = NaiveDate::from_ymd_opt(2026, 1, 1).unwrap();
        let jan_2 = NaiveDate::from_ymd_opt(2026, 1, 2).unwrap();
        let jan_3 = NaiveDate::from_ymd_opt(2026, 1, 3).unwrap();
        let jan_4 = NaiveDate::from_ymd_opt(2026, 1, 4).unwrap();
        let jan_5 = NaiveDate::from_ymd_opt(2026, 1, 5).unwrap();

        assert!(instances.iter().any(|i| i.date == jan_1));
        assert!(!instances.iter().any(|i| i.date == jan_2));
        assert!(instances.iter().any(|i| i.date == jan_3));
        assert!(!instances.iter().any(|i| i.date == jan_4));
        assert!(instances.iter().any(|i| i.date == jan_5));
    }

    
}