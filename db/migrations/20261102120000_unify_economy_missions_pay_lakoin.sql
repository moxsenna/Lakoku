-- Sederhanakan ekonomi (Opsi A):
-- Matikan missions_pay_tinta agar seluruh reward misi harian langsung membayar Lakoin (kredit baca).
-- Matikan author_rewards_enabled agar tidak ada reward Tinta tersembunyi yang membingungkan.

update public.tinta_policy
set missions_pay_tinta = false,
    author_rewards_enabled = false
where id = true;
