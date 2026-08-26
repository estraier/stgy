import PubGoogleAnalyticsPageView from "@/components/PubGoogleAnalyticsPageView";

type Props = {
  measurementId: string;
  contentGroup: string;
  contentId: string;
  contentType: string;
};

const GOOGLE_TAG_INIT_SCRIPT = `window.dataLayer=window.dataLayer||[];window.gtag=window.gtag||function(){window.dataLayer.push(arguments);};window.gtag("js",new Date());`;

export default function PubGoogleAnalytics({
  measurementId,
  contentGroup,
  contentId,
  contentType,
}: Props) {
  const tagId = measurementId.trim();
  if (!tagId) return null;

  return (
    <>
      <script
        async
        src={`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(tagId)}`}
      />
      <script dangerouslySetInnerHTML={{ __html: GOOGLE_TAG_INIT_SCRIPT }} />
      <PubGoogleAnalyticsPageView
        measurementId={tagId}
        contentGroup={contentGroup}
        contentId={contentId}
        contentType={contentType}
      />
    </>
  );
}
