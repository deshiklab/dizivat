import { matchPosSettlementLine } from "../../../../../../_r10"
export const POST = (req: Request, { params }: { params: Promise<{ id: string; lineId: string }> }) =>
  params.then((p) => matchPosSettlementLine(req, p.id, p.lineId))
