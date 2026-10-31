import type { FastifyInstance } from "fastify";
import type { RequestContext } from "../context.ts";
import { data, scope } from "../lib/http.ts";

export function registerStatisticsRoutes(app: FastifyInstance, context: RequestContext) {
  const { db, project } = context;
  app.get(`${scope}/statistics`, { preHandler: project }, async (r) =>
    db.transaction(async (tx) => {
      await tx.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const [currentProject] = await tx.query(
        "SELECT budget_cents FROM projects WHERE id=$1 AND family_id=$2",
        [r.project.id, r.familyId],
      );
      const args = [r.familyId, r.project.id];
      const [totals] = await tx.query(
        "SELECT COALESCE(sum(amount_cents),0) AS total_cents,COALESCE(sum(amount_cents) FILTER(WHERE payment_status='paid'),0) AS paid_cents,COALESCE(sum(amount_cents) FILTER(WHERE payment_status='pending'),0) AS pending_cents,count(*)::int AS cost_count FROM costs WHERE family_id=$1 AND project_id=$2 AND deleted_at IS NULL",
        args,
      );
      const [materials] = await tx.query(
        "SELECT COALESCE(sum(total_price_cents),0) AS planned_cents,count(*)::int AS material_count FROM materials WHERE family_id=$1 AND project_id=$2 AND deleted_at IS NULL",
        args,
      );
      const stages = await tx.query(
        "SELECT s.*,COALESCE((SELECT sum(c.amount_cents) FROM costs c WHERE c.stage_id=s.id AND c.deleted_at IS NULL),0) AS actual_cents,COALESCE((SELECT sum(m.total_price_cents) FROM materials m WHERE m.stage_id=s.id AND m.deleted_at IS NULL),0) AS planned_cents FROM stages s WHERE s.family_id=$1 AND s.project_id=$2 AND s.deleted_at IS NULL ORDER BY s.sort_order,s.created_at",
        args,
      );
      const byCategory = await tx.query(
        "SELECT category,sum(amount_cents) AS amount_cents FROM costs WHERE family_id=$1 AND project_id=$2 AND deleted_at IS NULL GROUP BY category ORDER BY amount_cents DESC",
        args,
      );
      const byMaterial = await tx.query(
        "SELECT material_id,COALESCE(sum(amount_cents),0) AS total_cents,COALESCE(sum(amount_cents) FILTER(WHERE payment_status='paid'),0) AS paid_cents,COALESCE(sum(amount_cents) FILTER(WHERE payment_status='pending'),0) AS pending_cents FROM costs WHERE family_id=$1 AND project_id=$2 AND deleted_at IS NULL AND material_id IS NOT NULL GROUP BY material_id",
        args,
      );
      const recent = await tx.query(
        "SELECT c.*,u.nickname AS creator_name FROM costs c JOIN users u ON c.created_by=u.id WHERE c.family_id=$1 AND c.project_id=$2 AND c.deleted_at IS NULL ORDER BY c.incurred_at DESC,c.created_at DESC LIMIT 5",
        args,
      );
      const [notes] = await tx.query(
        "SELECT count(*)::int AS pending_count FROM notes WHERE family_id=$1 AND project_id=$2 AND deleted_at IS NULL AND status='pending'",
        args,
      );
      return data({
        ...totals,
        ...materials,
        pendingNoteCount: notes!.pendingCount,
        budgetCents: currentProject!.budgetCents,
        balanceCents: currentProject!.budgetCents - totals!.totalCents,
        allocatedCents: stages.reduce((s, n) => s + n.budgetCents, 0),
        stages,
        byCategory,
        byMaterial,
        recent,
      });
    }),
  );
}
