import { getPosSale, patchPosSale } from "../../../_r10"
export const GET = (req: Request, { params }: { params: Promise<{ id: string }> }) => params.then((p) => getPosSale(req, p.id))
export const PATCH = (req: Request, { params }: { params: Promise<{ id: string }> }) => params.then((p) => patchPosSale(req, p.id))
