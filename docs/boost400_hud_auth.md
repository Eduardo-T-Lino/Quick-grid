# Revisão: ré, vácuo, boost, HUD e login local

- Ré: S freia antes de engatar ré, limitada a 50 km/h. Arrasto se opõe ao movimento; W permite retomar a marcha para frente.
- Boost: teto de 400 km/h; força 2,1×, mantendo três segundos de carga, recarga, exigência de asfalto e bloqueio durante ré/frenagem/pausa/largada.
- Vácuo: menor resistência e assistência de aceleração de até 18%; teto normal de 320 pode ganhar até 30 km/h, liberados a 2 km/h por segundo e proporcionais ao vácuo. Nunca soma velocidade acima do teto de boost. A perda de pressão aerodinâmica permanece.
- Automático selecionado por padrão; manual continua disponível.
- HUD: painel horizontal de instrumentos, marcha grande (incluindo R), velocidade central, energia do boost separada e classificação compacta. Sem alertas de perda de aderência nem efeitos de blur.
- `npm run dev` e `npm run preview` agora incluem a API real de autenticação no mesmo servidor Vite, sem depender de um backend separado na porta 3001. Requer reiniciar a prévia antiga para carregar a configuração.
- Contas locais são temporárias e somem ao reiniciar o servidor, com aviso na interface. PostgreSQL e cookies seguros de produção não foram alterados. Senhas de seis caracteres, inclusive seis números, continuam aceitas; hash scrypt e cookies HttpOnly preservados.
- Nenhuma publicação, alteração de recursos cloud, geometria de pista, IA ou ML3.

Os limites de velocidade são parâmetros de jogabilidade; boost e assistência de vácuo não representam um regulamento real de GT3.

## Validação local

- Gate ML2.2: 315 testes passaram; build de produção passou.
- Física real em Node: 13 verificações de boost/brita/ré/vácuo; 6 de tração; 7 de aerodinâmica; 4 de grid, preservando os 24 circuitos.
- Autenticação: 13 verificações backend; 12 verificações no navegador, usando a API real montada pelo Vite e conta sintética com seis dígitos.
- Navegador: 15 verificações de HUD/bots, 13 de boost/pausa/reinício, 11 de física RWD e 11 de layout/automático/ré em cada resolução 1264×625 e 390×844.
- A primeira execução de boost detectou estado ativo persistindo durante pausa. `pauseGame` agora limpa apenas esse estado, preservando carga/cooldown; a repetição passou.
- Evidência exclusivamente local; sem homologação do login publicado ou PostgreSQL real, sem benchmark de FPS nesta revisão.
