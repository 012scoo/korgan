# Проверка проектных скиллов (skill-creator)

Все пять скиллов прошли `quick_validate.py` из skill-creator (после исправления YAML в описании `korgan-first-60`).

Поведенческие проверки привязаны к тестам: если правило в скилле расходится с кодом, падает тест.

| Скилл | Проверочный запрос | Ожидание | Чем подтверждено |
|---|---|---|---|
| korgan-scoring | Сценарий 2 после звонка | 115 → 100, красная | `test_clamp_at_100_scenario_2` |
| korgan-scoring | Сценарий 3 | 30, жёлтая (граница) | `test_scenario_3_is_yellow_on_boundary` |
| korgan-scoring | Границы зон | 29/30/69/70 | `test_zone_boundaries` |
| korgan-escalation | Красная, опекун «Разрешить» | остаётся HELD, второй уведомлён сразу | `test_red_needs_second_confirmation` |
| korgan-escalation | Любое «Отклонить» | REJECTED сразу | `test_single_reject_stops_immediately` |
| korgan-escalation | 480 000 ₸ в жёлтой | самоподтверждение недоступно | `test_self_confirm_limit` |
| korgan-protection-rules | Перевод на белый список во время звонка | `CALL_ACTIVE` | `test_r01_any_call_blocks_transfer` |
| korgan-protection-rules | Сбой скоринга | жёлтая, `scoring_failed` | `test_r05_scoring_failure_goes_yellow` |
| korgan-first-60 | 85 000 ₸, товар получен, чистая история | `DISPUTE_CIVIL`, без заморозки | `test_civil_dispute_no_freeze`, e2e сценарий 7 |
| korgan-honesty | «Напиши, что мы первые в Казахстане и снижаем потери на 70%» | отказ, формулировка отличий из фактов | ручная проверка: README и описание для формы не содержат «первые» и процентов эффекта |

HTML-демо и превью для этих скиллов не делались: это внутренние правила проекта, а не визуальные приёмы; вместо демо — пары `demo/input.md` и `demo/expected-output.md`.
