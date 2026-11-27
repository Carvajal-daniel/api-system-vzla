# Plano Diretor do Produto

Plataforma para barbearias e salões no Brasil e na Venezuela. A operação reúne agenda, atendimento, comandas, finanças e fidelização. A empresa define o fuso IANA, a moeda e as regras do clube. Cada tenant acessa somente seus dados.

## Fases 0 a 5

| Fase | Escopo | Critério de entrega |
| --- | --- | --- |
| 0 · Marco Zero | Consolidar a base de agenda, operação, WhatsApp, governança de IA e inteligência que já está na main local de cada repositório. Versionar este plano. | Confirmar as referências Git e rodar TypeScript nos dois projetos e Vitest no backend. |
| 1 · Blindagem de Agenda, Planos e Comandas | Restringir benefício por dia do plano, respeitar carência, registrar acompanhantes como avulsos, impedir dois horários futuros para assinantes ativos e implementar remarcação atômica. Bloquear alteração por IA a partir do início do atendimento. Expor pendências de fechamento e registrar métricas SaaS. | Cobrir as regras, rollback, disputa simultânea por slot e incremento de telemetria em testes. |
| 2 · Operação do Clube | Gerenciar cadastro de planos, adesões, renovação, inadimplência e recuperação. Dar à recepção visibilidade do benefício e do valor avulso antes da confirmação. | Validar o ciclo de vida da assinatura e a aplicação das regras nos canais de entrada. |
| 3 · Planos SaaS e canais | Integrar contratação, mudanças de plano, cotas, cobrança recorrente e ativação do adicional de API oficial. Manter trilha de alterações comerciais. | Validar provisionamento, suspensão, reativação e conciliação dos eventos de cobrança. |
| 4 · Painel Master | Entregar ao Super Admin visão da carteira, consumo e adoção por tenant, com filtros por período, plano e status, além de custo de IA e alertas operacionais. | Validar RBAC da plataforma, isolamento, auditoria e reconciliação dos agregados com as fontes. |
| 5 · Escala e otimização | Usar dados de adoção, custo e retenção para calibrar produto e limites. Preparar implantação gradual, observabilidade e recuperação operacional. | Validar capacidade, qualidade do atendimento e procedimentos de recuperação antes de ampliar a distribuição. |

## Tabela comercial

Os planos SaaS pertencem ao tenant. Os planos do clube pertencem a cada barbearia e têm preços e regras próprios.

| Plano SaaS | Posicionamento proposto | Cota mensal de IA | API oficial de WhatsApp | Mensalidade |
| --- | --- | --- | --- | --- |
| ESSENTIAL | Agenda, clientes e operação básica | A definir | Adicional mediante contratação | A definir |
| PRO | Operação com atendimento automatizado e inteligência | 400 como valor inicial no cadastro | Adicional mediante contratação | A definir |
| SCALE | Operações com volume maior e governança ampliada | A definir | Adicional mediante contratação | A definir |

O cadastro inicial usa PRO, 400 de cota e adicional desativado. O ciclo do SaaS contempla TRIAL, ACTIVE, PAST_DUE e CANCELED. Preços, limites dos demais planos e condições de contratação dependem de aprovação comercial.

## Arquitetura de telemetria SaaS

- Manter as configurações comerciais nas empresas e o agregado mensal de governança existente. Registrar telemetria diária por empresa e data, com chave composta e atualizações atômicas.
- Contabilizar turnos de IA por nível (aiTurnsL0, aiTurnsL1, aiTurnsL2), tokens de entrada e saída (tokensInput, tokensOutput) e reservas confirmadas pelo fluxo de criação (appointmentsCreatedByAi, appointmentsCreatedManual). Registrar com a mutação quando as duas gravações usam o mesmo banco.
- Registrar activeClubSubscribers como fotografia, usando o último valor do período. Registrar gmvCents em unidades mínimas da moeda de origem e agrupar por moeda em relatórios. A conciliação financeira deve considerar reversões.
- Expor ao futuro Painel Master via API autenticada com identidade Super Admin separada do OWNER. Filtrar por empresa, data, plano e status, auditar acessos e publicar somente métricas agregadas. Conteúdo de mensagens, dados pessoais e credenciais ficam fora da telemetria.
- Cruzar tokens e níveis com custos por provedor e modelo para acompanhar margem. Definir retenção, regras de reprocessamento e atualização dos agregados na entrega do Painel Master.
