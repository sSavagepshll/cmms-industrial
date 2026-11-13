-- Insere o usuário admin padrao caso nao exista
INSERT INTO usuarios (nome, email, senha_hash, perfil, ativo)
SELECT 'Administrador', 'admin@om.com.br', 'scrypt$32768$8$1$oZkZoZ9eKm9BPKzELPkhww==$xzpzwXhHfGafQzOep+/qkNc8oop16UdWQOKBdC0CJPE=', 'ADMIN', true
WHERE NOT EXISTS (
    SELECT 1 FROM usuarios WHERE email = 'admin@om.com.br'
);
