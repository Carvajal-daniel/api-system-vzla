type Review = { stars: number | null; comment: string | null; service: string | null };
type Rating = { average: number; count: number };
type Locale = "pt-BR" | "es";

const themes = [
  {
    terms: /\b(atras[oa]s?|atrasad[oa]s?|esper[aa]s?|demor[ao]s?|retras[oa]s?|puntuali\w*|pontuali\w*)\b/,
    names: ["pontualidade", "puntualidad"],
    actions: ["Revise o tempo entre atendimentos e avise o cliente assim que houver atraso.", "Revisa el tiempo entre citas y avisa al cliente en cuanto haya un retraso."],
  },
  {
    terms: /\b(limp\w*|higien\w*|sujeir\w*|suci[oa]s?)\b/,
    names: ["limpeza", "limpieza"],
    actions: ["Inclua a higienização da bancada e dos instrumentos na rotina entre serviços.", "Incluye la limpieza del puesto y los instrumentos entre servicios."],
  },
  {
    terms: /\b(pre[çc]os?|precios?|car[oa]s?|cobran\w*|cobr[oa]s?)\b/,
    names: ["preço e cobrança", "precio y cobro"],
    actions: ["Confirme o preço e os adicionais com o cliente antes de iniciar o serviço.", "Confirma el precio y los adicionales con el cliente antes de empezar."],
  },
  {
    terms: /\b(atendimento\w*|atencion\w*|trato\w*|educad\w*|cort[eê]s\w*|amab\w*)\b/,
    names: ["atendimento", "atención"],
    actions: ["Alinhe com a equipe como receber o cliente, confirmar o pedido e revisar o resultado.", "Acuerda con el equipo cómo recibir al cliente, confirmar el pedido y revisar el resultado."],
  },
] as const;

export function analyzeSatisfaction(rating: Rating, reviews: Review[], locale: Locale) {
  const es = locale === "es";
  const language = es ? 1 : 0;
  const format = new Intl.NumberFormat(locale, { maximumFractionDigits: 1, minimumFractionDigits: 1 });
  const high = reviews.filter((review) => (review.stars ?? 0) >= 4);
  const low = reviews.filter((review) => review.stars !== null && review.stars <= 3);
  const byService = new Map<string, { count: number; total: number }>();
  for (const { service, stars } of reviews) {
    if (stars === null || !service) continue;
    const current = byService.get(service) ?? { count: 0, total: 0 };
    byService.set(service, { count: current.count + 1, total: current.total + stars });
  }
  const services = [...byService].map(([name, data]) => ({ name, average: data.total / data.count, count: data.count }))
    .sort((a, b) => b.average - a.average || b.count - a.count);
  const best = services.find((service) => service.average >= 4 && service.count >= 2);
  const worst = services.filter((service) => service.average < 4 && service.count >= 2).at(-1);
  const comments = low.flatMap((review) => review.comment ? [review.comment.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()] : []);
  const commonTheme = themes.map((theme) => ({ theme, count: comments.filter((comment) => theme.terms.test(comment)).length }))
    .sort((a, b) => b.count - a.count)[0];
  const topic = commonTheme?.count ? commonTheme.theme : null;

  return {
    strengths: [
      es ? `Media general: ${format.format(rating.average)}/5 en ${rating.count} evaluaciones.` : `Média geral: ${format.format(rating.average)}/5 em ${rating.count} avaliações.`,
      es ? `${high.length} de las ${reviews.length} evaluaciones recientes tienen 4 o 5 estrellas.` : `${high.length} das ${reviews.length} avaliações recentes têm 4 ou 5 estrelas.`,
      ...(best ? [es ? `${best.name} destaca con ${format.format(best.average)}/5 en ${best.count} evaluaciones recientes.` : `${best.name} se destaca com ${format.format(best.average)}/5 em ${best.count} avaliações recentes.`] : []),
    ],
    concerns: [
      es ? `${low.length} evaluaciones recientes tienen 3 estrellas o menos.` : `${low.length} avaliações recentes têm 3 estrelas ou menos.`,
      ...(topic ? [es ? `Tema más citado en comentarios con notas bajas: ${topic.names[language]}.` : `Tema mais citado em comentários com notas baixas: ${topic.names[language]}.`] : []),
      ...(reviews.length < 10 ? [es ? "La muestra es pequeña. Reúne más evaluaciones antes de sacar conclusiones por servicio." : "A amostra é pequena. Reúna mais avaliações antes de tirar conclusões por serviço."] : []),
    ],
    actions: [
      topic?.actions[language] ?? (es ? "Revisa con el equipo las evaluaciones y registra un ajuste concreto para la próxima semana." : "Revise as avaliações com a equipe e registre um ajuste concreto para a próxima semana."),
      worst
        ? es ? `Acompaña las próximas citas de ${worst.name} y comprueba qué cambia con el ajuste aplicado.` : `Acompanhe os próximos atendimentos de ${worst.name} e verifique o efeito do ajuste aplicado.`
        : es ? "Solicita una evaluación tras las próximas citas para aumentar la muestra por servicio." : "Solicite uma avaliação após os próximos atendimentos para ampliar a amostra por serviço.",
      es ? "Vuelve a medir la nota y los temas de los comentarios al final del mes." : "Meça novamente a nota e os temas dos comentários no fim do mês.",
    ],
  };
}
