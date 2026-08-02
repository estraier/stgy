export type AgreementTermContent = {
  locale: string;
  text: string;
};

export type AgreementTerm = {
  id: string;
  contents: AgreementTermContent[];
};
