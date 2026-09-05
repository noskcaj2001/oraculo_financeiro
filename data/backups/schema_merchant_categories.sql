-- Dicionário comerciante → categoria. Rode uma vez no SQL Editor do Supabase.
-- Consumido por backend/modules/personal_finance/categorizer.py e
-- recategorize_history.py.

create table if not exists public.merchant_categories (
    merchant_key text primary key,          -- categories.normalize_merchant(...)
    categoria    text not null,             -- slug de categories.CATEGORIES
    origem       text not null default 'ia' check (origem in ('historico', 'ia', 'manual')),
    confianca    real,                       -- 0..1 (IA); 1.0 (manual)
    evidencia    text,                       -- o que a busca web encontrou (fase 'refine')
    exemplos     jsonb,                      -- amostras de descrição
    ocorrencias  integer default 0,
    updated_at   timestamptz default now()
);

create index if not exists merchant_categories_categoria_idx
    on public.merchant_categories (categoria);
