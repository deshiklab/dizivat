"use client"

import { useLocale, useTranslations } from "next-intl"
import { Check, Minus } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { PERMISSIONS, ROLE_PERMS, ROLES } from "@/lib/auth/roles"
import { fmtNum } from "@/lib/format"

/** Read-only role × permission matrix — the same table the Symfony voters enforce (roles are fixed in R1). */
export function RolesMatrix({ counts }: { counts?: Record<string, number> }) {
  const t = useTranslations("users")
  const tr = useTranslations("roles")
  const locale = useLocale()
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("matrixTitle")}</CardTitle>
        <CardDescription>{t("matrixSub")}</CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto px-0" tabIndex={0} role="region" aria-label={t("matrixTitle")}>
        <table className="w-full min-w-[40rem] text-sm">
          <caption className="sr-only">{t("matrixTitle")}</caption>
          <thead>
            <tr className="border-b text-left">
              <th scope="col" className="px-4 py-2 font-medium text-muted-foreground">{t("permission")}</th>
              {ROLES.map((r) => (
                <th key={r} scope="col" className="px-3 py-2 text-center font-medium">
                  <span className="block">{tr(r)}</span>
                  {counts && <span className="block text-xs font-normal text-muted-foreground">{t("usersCount", { count: counts[r] ?? 0, n: fmtNum(counts[r] ?? 0, locale) })}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PERMISSIONS.map((p) => (
              <tr key={p} className="border-b last:border-0">
                <th scope="row" className="px-4 py-2 text-left font-normal">
                  <span className="block font-medium">{t(`perm.${p.replace(".", "_")}`)}</span>
                  <code className="text-xs text-muted-foreground">{p}</code>
                </th>
                {ROLES.map((r) => {
                  const ok = ROLE_PERMS[r].includes(p)
                  return (
                    <td key={r} className="px-3 py-2 text-center">
                      {ok
                        ? <Check className="mx-auto size-4 text-success" aria-label={t("allowed")} />
                        : <Minus className="mx-auto size-4 text-muted-foreground/60" aria-label={t("notAllowed")} />}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  )
}
