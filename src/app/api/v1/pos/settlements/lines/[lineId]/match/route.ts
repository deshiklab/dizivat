import { matchPosSettlementLine } from "../../../../../_r10"
export const POST = (req: Request, { params }: { params: Promise<{ lineId: string }> }) =>
  params.then((p) => matchPosSettlementLine(req, "", p.lineId))
