import { getBusinessDate } from "../lib/date.js";
/**
 * WalletService (Fase 15A) — autoridade central para saldo e créditos de pacote.
 * Nenhuma rota acessa tutorCreditsTable ou tutorServiceCreditsTable diretamente.
 */

import { WalletRepository } from "../repositories/wallet.repository.js";
import { CreditRepository } from "../repositories/credit.repository.js";
import { logFinancialAudit } from "./audit.js";

export class WalletService {
  /**
   * Returns the full balance summary for a tutor.
   */
  static async getBalance(tutorId: number, crecheId: number) {
    const today = getBusinessDate();
    const packages = await WalletRepository.getActivePackages(tutorId, crecheId, today);

    const totalCredits = packages.reduce((sum: number, p: any) => sum + p.totalCredits, 0);
    const usedCredits = packages.reduce((sum: number, p: any) => sum + p.usedCredits, 0);
    const availableCredits = packages.reduce(
      (sum: number, p: any) => sum + (p.totalCredits - p.usedCredits),
      0
    );
    const nearestExpiration =
      packages.find((p: any) => p.expirationDate)?.expirationDate ?? null;

    return { totalCredits, usedCredits, availableCredits, packages, nearestExpiration };
  }

  /**
   * Paginated list of package credits.
   * Admin: all tutors. Tutor: own only.
   */
  static async listPackages(
    crecheId: number,
    tutorId: number | null,
    pageSize: number,
    offset: number
  ) {
    return WalletRepository.listPackages(crecheId, tutorId, pageSize, offset);
  }

  /**
   * Paginated list of service credits (not fully used).
   */
  static async listServiceCredits(
    crecheId: number,
    tutorId: number | null,
    pageSize: number,
    offset: number
  ) {
    return WalletRepository.listServiceCredits(crecheId, tutorId, pageSize, offset);
  }

  /**
   * Manually creates a package credit row (admin action — no invoice generated).
   */
  static async createManualPackage(
    crecheId: number,
    tutorId: number,
    totalCredits: number,
    maxPetsPerDay: number,
    expirationDate: string | null | undefined,
    userId: number
  ) {
    const credits = await CreditRepository.createPackageCredits({
      crecheId,
      tutorId,
      totalCredits,
      usedCredits: 0,
      maxPetsPerDay: maxPetsPerDay || 1,
      expirationDate: expirationDate
        ? new Date(expirationDate).toISOString().split("T")[0]
        : null,
    });

    await logFinancialAudit({
      crecheId,
      userId,
      action: "credits_purchase",
      referenceId: credits.id,
      referenceType: "tutor_credits",
      details: `Pacote de ${totalCredits} créditos adquirido pelo tutor ${tutorId}.`,
    });

    return credits;
  }
}

