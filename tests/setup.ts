import { beforeAll } from 'vitest'

// Verificar variáveis de ambiente obrigatórias antes de rodar
beforeAll(() => {
  const required = [
    'DATABASE_URL',
    'ENCRYPTION_KEY',
  ]

  const missing = required.filter(key => !process.env[key])
  if (missing.length > 0) {
    throw new Error(
      `Variáveis de ambiente obrigatórias ausentes: ${missing.join(', ')}`
    )
  }
})
