
-- Riallinea le settings esistenti ai valori v2 del preset dichiarato in strategy_preset
-- Conservativo (75/25)
UPDATE public.settings SET
  core_satellite_split = '{"core":0.75,"satellite":0.25}'::jsonb,
  core_weights         = '{"BTC":0.7,"ETH":0.3}'::jsonb,
  min_volume_24h       = 5000000,
  max_spread_pct       = 0.3,
  min_listing_age_days = 60,
  macro_ma_period      = 200,
  mid_ma_period        = 50,
  fg_greed_cap         = 70,
  max_satellite_positions = 1,
  risk_per_trade_pct   = 2,
  stop_atr_mult        = 2,
  stop_min_pct         = 12,
  trailing_activate_pct= 15,
  trailing_gap_pct     = 10,
  take_profit_pct      = 25,
  min_target_pct       = 5,
  monthly_trade_cap    = 4,
  cooldown_hours       = 72,
  daily_loss_limit_pct = 5,
  timeframe            = '4h',
  max_positions        = 1,
  max_position_pct     = 20,
  stop_loss_pct        = 12
WHERE strategy_preset = 'conservative';

-- Bilanciato (60/40) — default v2
UPDATE public.settings SET
  core_satellite_split = '{"core":0.6,"satellite":0.4}'::jsonb,
  core_weights         = '{"BTC":0.6,"ETH":0.4}'::jsonb,
  min_volume_24h       = 5000000,
  max_spread_pct       = 0.3,
  min_listing_age_days = 60,
  macro_ma_period      = 200,
  mid_ma_period        = 50,
  fg_greed_cap         = 75,
  max_satellite_positions = 2,
  risk_per_trade_pct   = 3,
  stop_atr_mult        = 2,
  stop_min_pct         = 12,
  trailing_activate_pct= 12,
  trailing_gap_pct     = 8,
  take_profit_pct      = 25,
  min_target_pct       = 4,
  monthly_trade_cap    = 8,
  cooldown_hours       = 48,
  daily_loss_limit_pct = 8,
  timeframe            = '4h',
  max_positions        = 2,
  max_position_pct     = 30,
  stop_loss_pct        = 12
WHERE strategy_preset = 'balanced' OR strategy_preset IS NULL;

-- Aggressivo (45/55)
UPDATE public.settings SET
  core_satellite_split = '{"core":0.45,"satellite":0.55}'::jsonb,
  core_weights         = '{"BTC":0.5,"ETH":0.5}'::jsonb,
  min_volume_24h       = 5000000,
  max_spread_pct       = 0.3,
  min_listing_age_days = 60,
  macro_ma_period      = 200,
  mid_ma_period        = 50,
  fg_greed_cap         = 85,
  max_satellite_positions = 3,
  risk_per_trade_pct   = 4,
  stop_atr_mult        = 1.8,
  stop_min_pct         = 10,
  trailing_activate_pct= 12,
  trailing_gap_pct     = 8,
  take_profit_pct      = 30,
  min_target_pct       = 3,
  monthly_trade_cap    = 12,
  cooldown_hours       = 24,
  daily_loss_limit_pct = 10,
  timeframe            = '4h',
  max_positions        = 3,
  max_position_pct     = 40,
  stop_loss_pct        = 10
WHERE strategy_preset = 'aggressive';
