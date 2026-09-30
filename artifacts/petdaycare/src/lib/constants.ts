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
  pending: 'bg-muted text-muted-foreground border-border',
  awaiting_confirmation: 'bg-warning/20 text-warning border-warning/30',
  paid: 'bg-success/20 text-success border-success/30',
  overdue: 'bg-destructive/20 text-destructive border-destructive/30',
  voided: 'bg-muted text-muted-foreground border-border',
  refunded: 'bg-primary/20 text-primary border-primary/30',
};
