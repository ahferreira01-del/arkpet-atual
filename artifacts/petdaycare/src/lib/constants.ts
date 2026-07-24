export const ROUTES = {
  HOME: '/',
  LOGIN: '/login',
  REGISTER: '/cadastro',
  FORGOT_PASSWORD: '/recuperar-senha',
  RESET_PASSWORD: '/redefinir-senha',
  PETS: '/pets',
  BOOKINGS: '/bookings',
  STAFF: '/staff',
  STAFF_MANAGE: '/staff/manage',
  WALKS: '/walks',
  CHAT: '/chat',
  SETTINGS: '/settings',
  ADMIN: '/admin',
  ADMIN_CRECHES: '/admin/creches',
  ADMIN_USERS: '/admin/users',
  QR_SCANNER: '/staff/qr-scanner',
  TUTORS: '/tutors',
  BILLING: '/assinatura',
  BILLING_SUCCESS: '/assinatura/sucesso',
  FINANCIAL: '/financial',
  TUTOR_FINANCIAL: '/tutor/financial',
} as const;

export const INVOICE_STATUS_LABELS: Record<string, string> = {
  pending: 'Pendente',
  awaiting_confirmation: 'Aguardando confirmação',
  paid: 'Pago',
  overdue: 'Vencido',
  voided: 'Cancelado',
  refunded: 'Estornado',
};

export const INVOICE_STATUS_COLORS: Record<string, string> = {
  pending: 'bg-white/10 text-white',
  awaiting_confirmation: 'bg-amber-500/20 text-amber-500',
  paid: 'bg-emerald-500/20 text-emerald-400',
  overdue: 'bg-red-500/20 text-red-500',
  voided: 'bg-zinc-500/20 text-zinc-400',
  refunded: 'bg-purple-500/20 text-purple-400',
};
