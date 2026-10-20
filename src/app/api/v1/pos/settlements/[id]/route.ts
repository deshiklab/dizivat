import { deletePosSettlement, getPosSettlement } from "../../../_r10"
export const GET = (req: Request, { params }: { params: Promise<{ id: string }> }) => params.then((p) => getPosSettlement(req, p.id))
export const DELETE = (req: Request, { params }: { params: Promise<{ id: string }> }) => params.then((p) => deletePosSettlement(req, p.id))
