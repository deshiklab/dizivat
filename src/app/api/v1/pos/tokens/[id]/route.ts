import { deletePosToken } from "../../../_r10"
export const DELETE = (req: Request, { params }: { params: Promise<{ id: string }> }) => params.then((p) => deletePosToken(req, p.id))
