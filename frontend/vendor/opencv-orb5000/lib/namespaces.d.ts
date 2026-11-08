import type { MainModule } from './opencv.js'
type StaticMembers<T> = { [Key in keyof T]: T[Key] }
/** Native classes including nested types and inherited static factories. */
export type AugmentedModule = MainModule & {
/**
   * finds arbitrary template in the grayscale image using Generalized Hough Transform
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/imgproc/include/opencv2/imgproc.hpp#L913
   */
  GeneralizedHough: MainModule['GeneralizedHough'] & StaticMembers<MainModule['Algorithm']>
/**
   * finds arbitrary template in the grayscale image using Generalized Hough Transform
   *
   * Detects position only without translation and rotation [Ballard1981] .
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/imgproc/include/opencv2/imgproc.hpp#L949
   */
  GeneralizedHoughBallard: MainModule['GeneralizedHoughBallard'] & StaticMembers<MainModule['GeneralizedHough']> & StaticMembers<MainModule['Algorithm']>
/**
   * finds arbitrary template in the grayscale image using Generalized Hough Transform
   *
   * Detects position, translation and rotation [Guil1999] .
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/imgproc/include/opencv2/imgproc.hpp#L965
   */
  GeneralizedHoughGuil: MainModule['GeneralizedHoughGuil'] & StaticMembers<MainModule['GeneralizedHough']> & StaticMembers<MainModule['Algorithm']>
/**
   * imgproc_shape
   *
   * Base class for Contrast Limited Adaptive Histogram Equalization.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/imgproc/include/opencv2/imgproc.hpp#L1024
   */
  CLAHE: MainModule['CLAHE'] & StaticMembers<MainModule['Algorithm']>
/**
   * imgproc_hist
   *
   * example: samples/cpp/snippets/lsd_lines.cpp
   * An example using the LineSegmentDetector
   * \image html building_lsd.png "Sample output image" width=434 height=300
   * Line segment detector class
   *
   * following the algorithm described at [Rafael12] .
   *
   * **Note:** Implementation has been removed from OpenCV version 3.4.6 to 3.4.15 and version 4.1.0 to 4.5.3 due original code license conflict.
   * restored again after [Computation of a NFA](https://github.com/rafael-grompone-von-gioi/binomial_nfa) code published under the MIT license.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/imgproc/include/opencv2/imgproc.hpp#L1085
   */
  LineSegmentDetector: MainModule['LineSegmentDetector'] & StaticMembers<MainModule['Algorithm']>
/**
   * Base class for statistical models in OpenCV ML.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ml/include/opencv2/ml.hpp#L318
   */
  ml_StatModel: MainModule['ml_StatModel'] & StaticMembers<MainModule['Algorithm']>
/**
   * \
   *                                 Normal Bayes Classifier                                *
   * \***************************************************************************************
   * Bayes classifier for normally distributed data.
   *
   * See: `ml_intro_bayes`
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ml/include/opencv2/ml.hpp#L398
   */
  ml_NormalBayesClassifier: MainModule['ml_NormalBayesClassifier'] & StaticMembers<MainModule['ml_StatModel']> & StaticMembers<MainModule['Algorithm']>
/**
   * \
   *                          K-Nearest Neighbour Classifier                                *
   * \***************************************************************************************
   * The class implements K-Nearest Neighbors model
   *
   * See: `ml_intro_knn`
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ml/include/opencv2/ml.hpp#L436
   */
  ml_KNearest: MainModule['ml_KNearest'] & StaticMembers<MainModule['ml_StatModel']> & StaticMembers<MainModule['Algorithm']>
/**
   * \
   *                                   Support Vector Machines                              *
   * \***************************************************************************************
   * Support Vector Machines.
   *
   * See: `ml_intro_svm`
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ml/include/opencv2/ml.hpp#L526
   */
  ml_SVM: MainModule['ml_SVM'] & StaticMembers<MainModule['ml_StatModel']> & StaticMembers<MainModule['Algorithm']>
/**
   * \
   *                              Expectation - Maximization                                *
   * \***************************************************************************************
   * The class implements the Expectation Maximization algorithm.
   *
   * See: `ml_intro_em`
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ml/include/opencv2/ml.hpp#L836
   */
  ml_EM: MainModule['ml_EM'] & StaticMembers<MainModule['ml_StatModel']> & StaticMembers<MainModule['Algorithm']>
/**
   * \
   *                                      Decision Tree                                     *
   * \***************************************************************************************
   * The class represents a single decision tree or a collection of decision trees.
   *
   * The current public interface of the class allows user to train only a single decision tree, however
   * the class is capable of storing multiple decision trees and using them for prediction (by summing
   * responses or using a voting schemes), and the derived from DTrees classes (such as RTrees and Boost)
   * use this capability to implement decision tree ensembles.
   *
   * See: `ml_intro_trees`
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ml/include/opencv2/ml.hpp#L1053
   */
  ml_DTrees: MainModule['ml_DTrees'] & StaticMembers<MainModule['ml_StatModel']> & StaticMembers<MainModule['Algorithm']>
/**
   * \
   *                                   Random Trees Classifier                              *
   * \***************************************************************************************
   * The class implements the random forest predictor.
   *
   * See: `ml_intro_rtrees`
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ml/include/opencv2/ml.hpp#L1247
   */
  ml_RTrees: MainModule['ml_RTrees'] & StaticMembers<MainModule['ml_DTrees']> & StaticMembers<MainModule['ml_StatModel']> & StaticMembers<MainModule['Algorithm']>
/**
   * \
   *                                   Boosted tree classifier                              *
   * \***************************************************************************************
   * Boosted tree classifier derived from DTrees
   *
   * See: `ml_intro_boost`
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ml/include/opencv2/ml.hpp#L1332
   */
  ml_Boost: MainModule['ml_Boost'] & StaticMembers<MainModule['ml_DTrees']> & StaticMembers<MainModule['ml_StatModel']> & StaticMembers<MainModule['Algorithm']>
/**
   * \
   *                                   Gradient Boosted Trees                               *
   * \***************************************************************************************
   * class CV_EXPORTS_W GBTrees : public DTrees
   * {
   * public:
   *     struct CV_EXPORTS_W_MAP Params : public DTrees::Params
   *     {
   *         CV_PROP_RW int weakCount;
   *         CV_PROP_RW int lossFunctionType;
   *         CV_PROP_RW float subsamplePortion;
   *         CV_PROP_RW float shrinkage;
   *
   *         Params();
   *         Params( int lossFunctionType, int weakCount, float shrinkage,
   *                 float subsamplePortion, int maxDepth, bool useSurrogates );
   *     };
   *
   *     enum {SQUARED_LOSS=0, ABSOLUTE_LOSS, HUBER_LOSS=3, DEVIANCE_LOSS};
   *
   *     virtual void setK(int k) = 0;
   *
   *     virtual float predictSerial( InputArray samples,
   *                                  OutputArray weakResponses, int flags) const = 0;
   *
   *     static Ptr<GBTrees> create(const Params& p);
   * };
   * \
   *                              Artificial Neural Networks (ANN)                          *
   * \***************************************************************************************
   * Multi-Layer Perceptrons //////////////////////////////
   * Artificial Neural Networks - Multi-Layer Perceptrons.
   *
   * Unlike many other models in ML that are constructed and trained at once, in the MLP model these
   * steps are separated. First, a network with the specified topology is created using the non-default
   * constructor or the method ANN_MLP::create. All the weights are set to zeros. Then, the network is
   * trained using a set of input and output vectors. The training procedure can be repeated more than
   * once, that is, the weights can be adjusted based on the new training data.
   *
   * Additional flags for StatModel::train are available: ANN_MLP::TrainFlags.
   *
   * See: `ml_intro_ann`
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ml/include/opencv2/ml.hpp#L1431
   */
  ml_ANN_MLP: MainModule['ml_ANN_MLP'] & StaticMembers<MainModule['ml_StatModel']> & StaticMembers<MainModule['Algorithm']>
/**
   * \
   *                           Logistic Regression                                          *
   * \***************************************************************************************
   * Implements Logistic Regression classifier.
   *
   * See: `ml_intro_lr`
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ml/include/opencv2/ml.hpp#L1629
   */
  ml_LogisticRegression: MainModule['ml_LogisticRegression'] & StaticMembers<MainModule['ml_StatModel']> & StaticMembers<MainModule['Algorithm']>
/**
   * \
   *                        Stochastic Gradient Descent SVM Classifier                      *
   * \***************************************************************************************
   * Stochastic Gradient Descent SVM classifier
   *
   * SVMSGD provides a fast and easy-to-use implementation of the SVM classifier using the Stochastic Gradient Descent approach,
   * as presented in [bottou2010large].
   *
   * The classifier has following parameters:
   * - model type,
   * - margin type,
   * - margin regularization (`\lambda`),
   * - initial step size (`\gamma_0`),
   * - step decreasing power (`c`),
   * - and termination criteria.
   *
   * The model type may have one of the following values: `SGD` and `ASGD.`
   *
   * - `SGD` is the classic version of SVMSGD classifier: every next step is calculated by the formula
   *   
   * ```math
   * w_{t+1} = w_t - \gamma(t) \frac{dQ_i}{dw} |_{w = w_t}
   * ```
   *
   *   where
   *   - `w_t` is the weights vector for decision function at step `t`,
   *   - `\gamma(t)` is the step size of model parameters at the iteration `t`, it is decreased on each step by the formula
   *     `\gamma(t) = \gamma_0  (1 + \lambda  \gamma_0 t) ^ {-c}`
   *   - `Q_i` is the target functional from SVM task for sample with number `i`, this sample is chosen stochastically on each step of the algorithm.
   *
   * - `ASGD` is Average Stochastic Gradient Descent SVM Classifier. ASGD classifier averages weights vector on each step of algorithm by the formula
   * `\widehat{w}_{t+1} = \frac{t}{1+t}\widehat{w}_{t} + \frac{1}{1+t}w_{t+1}`
   *
   * The recommended model type is ASGD (following [bottou2010large]).
   *
   * The margin type may have one of the following values: `SOFT_MARGIN` or `HARD_MARGIN.`
   *
   * - You should use `HARD_MARGIN` type, if you have linearly separable sets.
   * - You should use `SOFT_MARGIN` type, if you have non-linearly separable sets or sets with outliers.
   * - In the general case (if you know nothing about linear separability of your sets), use SOFT_MARGIN.
   *
   * The other parameters may be described as follows:
   * - Margin regularization parameter is responsible for weights decreasing at each step and for the strength of restrictions on outliers
   *   (the less the parameter, the less probability that an outlier will be ignored).
   *   Recommended value for SGD model is 0.0001, for ASGD model is 0.00001.
   *
   * - Initial step size parameter is the initial value for the step size `\gamma(t)`.
   *   You will have to find the best initial step for your problem.
   *
   * - Step decreasing power is the power parameter for `\gamma(t)` decreasing by the formula, mentioned above.
   *   Recommended value for SGD model is 1, for ASGD model is 0.75.
   *
   * - Termination criteria can be TermCriteria::COUNT, TermCriteria::EPS or TermCriteria::COUNT + TermCriteria::EPS.
   *   You will have to find the best termination criteria for your problem.
   *
   * Note that the parameters margin regularization, initial step size, and step decreasing power should be positive.
   *
   * To use SVMSGD algorithm do as follows:
   *
   * - first, create the SVMSGD object. The algorithm will set optimal parameters by default, but you can set your own parameters via functions setSvmsgdType(),
   *   setMarginType(), setMarginRegularization(), setInitialStepSize(), and setStepDecreasingPower().
   *
   * - then the SVM model can be trained using the train features and the correspondent labels by the method train().
   *
   * - after that, the label of a new feature vector can be predicted using the method predict().
   *
   * ```cpp
   * // Create empty object
   * cv::Ptr<SVMSGD> svmsgd = SVMSGD::create();
   *
   * // Train the Stochastic Gradient Descent SVM
   * svmsgd->train(trainData);
   *
   * // Predict labels for the new samples
   * svmsgd->predict(samples, responses);
   *
   * ```
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ml/include/opencv2/ml.hpp#L1796
   */
  ml_SVMSGD: MainModule['ml_SVMSGD'] & StaticMembers<MainModule['ml_StatModel']> & StaticMembers<MainModule['Algorithm']>
/**
   * Class implementing two-dimensional phase unwrapping based on [histogramUnwrapping]
   * This algorithm belongs to the quality-guided phase unwrapping methods.
   * First, it computes a reliability map from second differences between a pixel and its eight neighbours.
   * Reliability values lie between 0 and 16*pi*pi. Then, this reliability map is used to compute
   * the reliabilities of "edges". An edge is an entity defined by two pixels that are connected
   * horizontally or vertically. Its reliability is found by adding the the reliabilities of the
   * two pixels connected through it. Edges are sorted in a histogram based on their reliability values.
   * This histogram is then used to unwrap pixels, starting from the highest quality pixel.
   * The wrapped phase map and the unwrapped result are stored in CV_32FC1 Mat.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/phase_unwrapping/include/opencv2/phase_unwrapping/histogramphaseunwrapping.hpp#L65
   */
  phase_unwrapping_HistogramPhaseUnwrapping: MainModule['phase_unwrapping_HistogramPhaseUnwrapping'] & StaticMembers<MainModule['phase_unwrapping_PhaseUnwrapping']> & StaticMembers<MainModule['Algorithm']> & {
/**
   * Parameters of phaseUnwrapping constructor.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/phase_unwrapping/include/opencv2/phase_unwrapping/histogramphaseunwrapping.hpp#L78
   */
 Params: MainModule['phase_unwrapping_HistogramPhaseUnwrapping_Params']
 }
/**
   * Abstract base class for phase unwrapping.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/phase_unwrapping/include/opencv2/phase_unwrapping/phase_unwrapping.hpp#L55
   */
  phase_unwrapping_PhaseUnwrapping: MainModule['phase_unwrapping_PhaseUnwrapping'] & StaticMembers<MainModule['Algorithm']>
/**
   * Base class for tonemapping algorithms - tools that are used to map HDR image to 8-bit range.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/photo/include/opencv2/photo.hpp#L336
   */
  Tonemap: MainModule['Tonemap'] & StaticMembers<MainModule['Algorithm']>
/**
   * Adaptive logarithmic mapping is a fast global tonemapping algorithm that scales the image in
   * logarithmic domain.
   *
   * Since it's a global operator the same function is applied to all the pixels, it is controlled by the
   * bias parameter.
   *
   * Optional saturation enhancement is possible as described in [FL02] .
   *
   * For more information see [DM03] .
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/photo/include/opencv2/photo.hpp#L368
   */
  TonemapDrago: MainModule['TonemapDrago'] & StaticMembers<MainModule['Tonemap']> & StaticMembers<MainModule['Algorithm']>
/**
   * This is a global tonemapping operator that models human visual system.
   *
   * Mapping function is controlled by adaptation parameter, that is computed using light adaptation and
   * color adaptation.
   *
   * For more information see [RD05] .
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/photo/include/opencv2/photo.hpp#L397
   */
  TonemapReinhard: MainModule['TonemapReinhard'] & StaticMembers<MainModule['Tonemap']> & StaticMembers<MainModule['Algorithm']>
/**
   * This algorithm transforms image to contrast using gradients on all levels of gaussian pyramid,
   * transforms contrast values to HVS response and scales the response. After this the image is
   * reconstructed from new contrast values.
   *
   * For more information see [MM06] .
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/photo/include/opencv2/photo.hpp#L428
   */
  TonemapMantiuk: MainModule['TonemapMantiuk'] & StaticMembers<MainModule['Tonemap']> & StaticMembers<MainModule['Algorithm']>
/**
   * The base class for algorithms that align images of the same scene with different exposures
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/photo/include/opencv2/photo.hpp#L450
   */
  AlignExposures: MainModule['AlignExposures'] & StaticMembers<MainModule['Algorithm']>
/**
   * This algorithm converts images to median threshold bitmaps (1 for pixels brighter than median
   * luminance and 0 otherwise) and than aligns the resulting bitmaps using bit operations.
   *
   * It is invariant to exposure, so exposure values and camera response are not necessary.
   *
   * In this implementation new image regions are filled with zeros.
   *
   * For more information see [GW03] .
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/photo/include/opencv2/photo.hpp#L474
   */
  AlignMTB: MainModule['AlignMTB'] & StaticMembers<MainModule['AlignExposures']> & StaticMembers<MainModule['Algorithm']>
/**
   * The base class for camera response calibration algorithms.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/photo/include/opencv2/photo.hpp#L531
   */
  CalibrateCRF: MainModule['CalibrateCRF'] & StaticMembers<MainModule['Algorithm']>
/**
   * Inverse camera response function is extracted for each brightness value by minimizing an objective
   * function as linear system. Objective function is constructed using pixel values on the same position
   * in all images, extra term is added to make the result smoother.
   *
   * For more information see [DM97] .
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/photo/include/opencv2/photo.hpp#L549
   */
  CalibrateDebevec: MainModule['CalibrateDebevec'] & StaticMembers<MainModule['CalibrateCRF']> & StaticMembers<MainModule['Algorithm']>
/**
   * Inverse camera response function is extracted for each brightness value by minimizing an objective
   * function as linear system. This algorithm uses all image pixels.
   *
   * For more information see [RB99] .
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/photo/include/opencv2/photo.hpp#L577
   */
  CalibrateRobertson: MainModule['CalibrateRobertson'] & StaticMembers<MainModule['CalibrateCRF']> & StaticMembers<MainModule['Algorithm']>
/**
   * The base class algorithms that can merge exposure sequence to a single image.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/photo/include/opencv2/photo.hpp#L598
   */
  MergeExposures: MainModule['MergeExposures'] & StaticMembers<MainModule['Algorithm']>
/**
   * The resulting HDR image is calculated as weighted average of the exposures considering exposure
   * values and camera response.
   *
   * For more information see [DM97] .
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/photo/include/opencv2/photo.hpp#L618
   */
  MergeDebevec: MainModule['MergeDebevec'] & StaticMembers<MainModule['MergeExposures']> & StaticMembers<MainModule['Algorithm']>
/**
   * Pixels are weighted using contrast, saturation and well-exposedness measures, than images are
   * combined using laplacian pyramids.
   *
   * The resulting image weight is constructed as weighted average of contrast, saturation and
   * well-exposedness measures.
   *
   * The resulting image doesn't require tonemapping and can be converted to 8-bit image by multiplying
   * by 255, but it's recommended to apply gamma correction and/or linear tonemapping.
   *
   * For more information see [MK07] .
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/photo/include/opencv2/photo.hpp#L641
   */
  MergeMertens: MainModule['MergeMertens'] & StaticMembers<MainModule['MergeExposures']> & StaticMembers<MainModule['Algorithm']>
/**
   * The resulting HDR image is calculated as weighted average of the exposures considering exposure
   * values and camera response.
   *
   * For more information see [RB99] .
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/photo/include/opencv2/photo.hpp#L677
   */
  MergeRobertson: MainModule['MergeRobertson'] & StaticMembers<MainModule['MergeExposures']> & StaticMembers<MainModule['Algorithm']>
/**
   * plot plot2d value in the OpenCV API.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/plot/include/opencv2/plot.hpp#L65
   */
  plot_Plot2d: MainModule['plot_Plot2d'] & StaticMembers<MainModule['Algorithm']>
/**
   * Quality Base Class ***********************************
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/quality/include/opencv2/quality/qualitybase.hpp#L23
   */
  quality_QualityBase: MainModule['quality_QualityBase'] & StaticMembers<MainModule['Algorithm']>
/**
   * BRISQUE (Blind/Referenceless Image Spatial Quality Evaluator) is a No Reference Image Quality Assessment (NR-IQA) algorithm.
   *
   * BRISQUE computes a score based on extracting Natural Scene Statistics (https://en.wikipedia.org/wiki/Scene_statistics)
   * and calculating feature vectors. See Mittal et al. [Mittal2] for original paper and original implementation [Mittal2_software] .
   *
   * A trained model is provided in the /samples/ directory and is trained on the LIVE-R2 database [Sheikh] as in the original implementation.
   * When evaluated against the TID2008 database [Ponomarenko] , the SROCC is -0.8424 versus the SROCC of -0.8354 in the original implementation.
   * C++ code for the BRISQUE LIVE-R2 trainer and TID2008 evaluator are also provided in the /samples/ directory.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/quality/include/opencv2/quality/qualitybrisque.hpp#L26
   */
  quality_QualityBRISQUE: MainModule['quality_QualityBRISQUE'] & StaticMembers<MainModule['quality_QualityBase']> & StaticMembers<MainModule['Algorithm']>
/**
   * Full reference GMSD algorithm
   * http://www4.comp.polyu.edu.hk/~cslzhang/IQA/GMSD/GMSD.htm
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/quality/include/opencv2/quality/qualitygmsd.hpp#L19
   */
  quality_QualityGMSD: MainModule['quality_QualityGMSD'] & StaticMembers<MainModule['quality_QualityBase']> & StaticMembers<MainModule['Algorithm']>
/**
   * Full reference mean square error algorithm  https://en.wikipedia.org/wiki/Mean_squared_error
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/quality/include/opencv2/quality/qualitymse.hpp#L18
   */
  quality_QualityMSE: MainModule['quality_QualityMSE'] & StaticMembers<MainModule['quality_QualityBase']> & StaticMembers<MainModule['Algorithm']>
/**
   * Full reference peak signal to noise ratio (PSNR) algorithm  https://en.wikipedia.org/wiki/Peak_signal-to-noise_ratio
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/quality/include/opencv2/quality/qualitypsnr.hpp#L20
   */
  quality_QualityPSNR: MainModule['quality_QualityPSNR'] & StaticMembers<MainModule['quality_QualityBase']> & StaticMembers<MainModule['Algorithm']>
/**
   * Full reference structural similarity algorithm  https://en.wikipedia.org/wiki/Structural_similarity
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/quality/include/opencv2/quality/qualityssim.hpp#L18
   */
  quality_QualitySSIM: MainModule['quality_QualitySSIM'] & StaticMembers<MainModule['quality_QualityBase']> & StaticMembers<MainModule['Algorithm']>
/**
   * Abstract base class for stateful silhouette trackers
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/rapid/include/opencv2/rapid.hpp#L127
   */
  rapid_Tracker: MainModule['rapid_Tracker'] & StaticMembers<MainModule['Algorithm']>
/**
   * wrapper around `rapid` function for uniform access
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/rapid/include/opencv2/rapid.hpp#L138
   */
  rapid_Rapid: MainModule['rapid_Rapid'] & StaticMembers<MainModule['rapid_Tracker']> & StaticMembers<MainModule['Algorithm']>
/**
   * implements "Optimal local searching for fast and robust textureless 3D object tracking in highly
   * cluttered backgrounds" [seo2013optimal]
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/rapid/include/opencv2/rapid.hpp#L147
   */
  rapid_OLSTracker: MainModule['rapid_OLSTracker'] & StaticMembers<MainModule['rapid_Tracker']> & StaticMembers<MainModule['Algorithm']>
/**
   * implements "Global optimal searching for textureless 3D object tracking" [wang2015global]
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/rapid/include/opencv2/rapid.hpp#L155
   */
  rapid_GOSTracker: MainModule['rapid_GOSTracker'] & StaticMembers<MainModule['rapid_Tracker']> & StaticMembers<MainModule['Algorithm']>
/**
   * Defines an affine transformation
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/reg/include/opencv2/reg/mapaffine.hpp#L52
   */
  reg_MapAffine: MainModule['reg_MapAffine'] & StaticMembers<MainModule['reg_Map']>
/**
   * Mapper for affine motion
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/reg/include/opencv2/reg/mappergradaffine.hpp#L52
   */
  reg_MapperGradAffine: MainModule['reg_MapperGradAffine'] & StaticMembers<MainModule['reg_Mapper']>
/**
   * Mapper for euclidean motion: rotation plus shift
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/reg/include/opencv2/reg/mappergradeuclid.hpp#L52
   */
  reg_MapperGradEuclid: MainModule['reg_MapperGradEuclid'] & StaticMembers<MainModule['reg_Mapper']>
/**
   * Gradient mapper for a projective transformation
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/reg/include/opencv2/reg/mappergradproj.hpp#L52
   */
  reg_MapperGradProj: MainModule['reg_MapperGradProj'] & StaticMembers<MainModule['reg_Mapper']>
/**
   * Gradient mapper for a translation
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/reg/include/opencv2/reg/mappergradshift.hpp#L52
   */
  reg_MapperGradShift: MainModule['reg_MapperGradShift'] & StaticMembers<MainModule['reg_Mapper']>
/**
   * Calculates a similarity transformation between to images (scale, rotation, and shift)
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/reg/include/opencv2/reg/mappergradsimilar.hpp#L52
   */
  reg_MapperGradSimilar: MainModule['reg_MapperGradSimilar'] & StaticMembers<MainModule['reg_Mapper']>
/**
   * Calculates a map using a gaussian pyramid
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/reg/include/opencv2/reg/mapperpyramid.hpp#L55
   */
  reg_MapperPyramid: MainModule['reg_MapperPyramid'] & StaticMembers<MainModule['reg_Mapper']>
/**
   * Defines an transformation that consists on a projective transformation
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/reg/include/opencv2/reg/mapprojec.hpp#L53
   */
  reg_MapProjec: MainModule['reg_MapProjec'] & StaticMembers<MainModule['reg_Map']>
/**
   * Defines an transformation that consists on a simple displacement
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/reg/include/opencv2/reg/mapshift.hpp#L53
   */
  reg_MapShift: MainModule['reg_MapShift'] & StaticMembers<MainModule['reg_Map']>
/**
   * Modality that computes quantized gradient orientations from a color image.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/rgbd/include/opencv2/rgbd/linemod.hpp#L166
   */
  linemod_ColorGradient: MainModule['linemod_ColorGradient'] & StaticMembers<MainModule['linemod_Modality']>
/**
   * Modality that computes quantized surface normals from a dense depth map.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/rgbd/include/opencv2/rgbd/linemod.hpp#L203
   */
  linemod_DepthNormal: MainModule['linemod_DepthNormal'] & StaticMembers<MainModule['linemod_Modality']>
/**
   * Abstract base class for histogram cost algorithms.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/shape/include/opencv2/shape/hist_cost.hpp#L58
   */
  HistogramCostExtractor: MainModule['HistogramCostExtractor'] & StaticMembers<MainModule['Algorithm']>
/**
   * A norm based cost extraction. :
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/shape/include/opencv2/shape/hist_cost.hpp#L72
   */
  NormHistogramCostExtractor: MainModule['NormHistogramCostExtractor'] & StaticMembers<MainModule['HistogramCostExtractor']> & StaticMembers<MainModule['Algorithm']>
/**
   * An EMD based cost extraction. :
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/shape/include/opencv2/shape/hist_cost.hpp#L84
   */
  EMDHistogramCostExtractor: MainModule['EMDHistogramCostExtractor'] & StaticMembers<MainModule['HistogramCostExtractor']> & StaticMembers<MainModule['Algorithm']>
/**
   * An Chi based cost extraction. :
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/shape/include/opencv2/shape/hist_cost.hpp#L96
   */
  ChiHistogramCostExtractor: MainModule['ChiHistogramCostExtractor'] & StaticMembers<MainModule['HistogramCostExtractor']> & StaticMembers<MainModule['Algorithm']>
/**
   * An EMD-L1 based cost extraction. :
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/shape/include/opencv2/shape/hist_cost.hpp#L103
   */
  EMDL1HistogramCostExtractor: MainModule['EMDL1HistogramCostExtractor'] & StaticMembers<MainModule['HistogramCostExtractor']> & StaticMembers<MainModule['Algorithm']>
/**
   * example: modules/shape/samples/shape_example.cpp
   * An example using shape distance algorithm
   * Abstract base class for shape distance algorithms.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/shape/include/opencv2/shape/shape_distance.hpp#L61
   */
  ShapeDistanceExtractor: MainModule['ShapeDistanceExtractor'] & StaticMembers<MainModule['Algorithm']>
/**
   * Implementation of the Shape Context descriptor and matching algorithm
   *
   * proposed by Belongie et al. in "Shape Matching and Object Recognition Using Shape Contexts" (PAMI
   * 2002). This implementation is packaged in a generic scheme, in order to allow you the
   * implementation of the common variations of the original pipeline.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/shape/include/opencv2/shape/shape_distance.hpp#L81
   */
  ShapeContextDistanceExtractor: MainModule['ShapeContextDistanceExtractor'] & StaticMembers<MainModule['ShapeDistanceExtractor']> & StaticMembers<MainModule['Algorithm']>
/**
   * A simple Hausdorff distance measure between shapes defined by contours
   *
   * according to the paper "Comparing Images using the Hausdorff distance." by D.P. Huttenlocher, G.A.
   * Klanderman, and W.J. Rucklidge. (PAMI 1993). :
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/shape/include/opencv2/shape/shape_distance.hpp#L200
   */
  HausdorffDistanceExtractor: MainModule['HausdorffDistanceExtractor'] & StaticMembers<MainModule['ShapeDistanceExtractor']> & StaticMembers<MainModule['Algorithm']>
/**
   * Abstract base class for shape transformation algorithms.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/shape/include/opencv2/shape/shape_transformer.hpp#L58
   */
  ShapeTransformer: MainModule['ShapeTransformer'] & StaticMembers<MainModule['Algorithm']>
/**
   * Definition of the transformation
   *
   * occupied in the paper "Principal Warps: Thin-Plate Splines and Decomposition of Deformations", by
   * F.L. Bookstein (PAMI 1989). :
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/shape/include/opencv2/shape/shape_transformer.hpp#L98
   */
  ThinPlateSplineShapeTransformer: MainModule['ThinPlateSplineShapeTransformer'] & StaticMembers<MainModule['ShapeTransformer']> & StaticMembers<MainModule['Algorithm']>
/**
   * Wrapper class for the OpenCV Affine Transformation algorithm. :
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/shape/include/opencv2/shape/shape_transformer.hpp#L119
   */
  AffineTransformer: MainModule['AffineTransformer'] & StaticMembers<MainModule['ShapeTransformer']> & StaticMembers<MainModule['Algorithm']>
/**
   * namespace fisheye
   * The base class for stereo correspondence algorithms.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/stereo/include/opencv2/stereo.hpp#L241
   */
  StereoMatcher: MainModule['StereoMatcher'] & StaticMembers<MainModule['Algorithm']>
/**
   * Class for computing stereo correspondence using the block matching algorithm, introduced and
   * contributed to OpenCV by K. Konolige.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/stereo/include/opencv2/stereo.hpp#L282
   */
  StereoBM: MainModule['StereoBM'] & StaticMembers<MainModule['StereoMatcher']> & StaticMembers<MainModule['Algorithm']>
/**
   * The class implements the modified H. Hirschmuller algorithm [HH08] that differs from the original
   * one as follows:
   *
   * -   By default, the algorithm is single-pass, which means that you consider only 5 directions
   * instead of 8. Set mode=StereoSGBM::MODE_HH in createStereoSGBM to run the full variant of the
   * algorithm but beware that it may consume a lot of memory.
   * -   The algorithm matches blocks, not individual pixels. Though, setting blockSize=1 reduces the
   * blocks to single pixels.
   * -   Mutual information cost function is not implemented. Instead, a simpler Birchfield-Tomasi
   * sub-pixel metric from [BT98] is used. Though, the color images are supported as well.
   * -   Some pre- and post- processing steps from K. Konolige algorithm StereoBM are included, for
   * example: pre-filtering (StereoBM::PREFILTER_XSOBEL type) and post-filtering (uniqueness
   * check, quadratic interpolation and speckle filtering).
   *
   * **Note:** -   (Python) An example illustrating the use of the StereoSGBM matching algorithm can be found
   *         at opencv_source_code/samples/python/stereo_match.py
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/stereo/include/opencv2/stereo.hpp#L347
   */
  StereoSGBM: MainModule['StereoSGBM'] & StaticMembers<MainModule['StereoMatcher']> & StaticMembers<MainModule['Algorithm']>
/**
   * The base class for auto white balance algorithms.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xphoto/include/opencv2/xphoto/white_balance.hpp#L63
   */
  xphoto_WhiteBalancer: MainModule['xphoto_WhiteBalancer'] & StaticMembers<MainModule['Algorithm']>
/**
   * A simple white balance algorithm that works by independently stretching
   *     each of the input image channels to the specified range. For increased robustness
   *     it ignores the top and bottom `p\%` of pixel values.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xphoto/include/opencv2/xphoto/white_balance.hpp#L79
   */
  xphoto_SimpleWB: MainModule['xphoto_SimpleWB'] & StaticMembers<MainModule['xphoto_WhiteBalancer']> & StaticMembers<MainModule['Algorithm']>
/**
   * Gray-world white balance algorithm
   *
   * This algorithm scales the values of pixels based on a
   * gray-world assumption which states that the average of all channels
   * should result in a gray image.
   *
   * It adds a modification which thresholds pixels based on their
   * saturation value and only uses pixels below the provided threshold in
   * finding average pixel values.
   *
   * Saturation is calculated using the following for a 3-channel RGB image per
   * pixel I and is in the range [0, 1]:
   *
   * ```math
   *  \texttt{Saturation} [I] = \frac{\textrm{max}(R,G,B) - \textrm{min}(R,G,B)
   * }{\textrm{max}(R,G,B)} 
   * ```
   *
   * A threshold of 1 means that all pixels are used to white-balance, while a
   * threshold of 0 means no pixels are used. Lower thresholds are useful in
   * white-balancing saturated images.
   *
   * Currently supports images of type `CV_8UC3` and `CV_16UC3.`
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xphoto/include/opencv2/xphoto/white_balance.hpp#L139
   */
  xphoto_GrayworldWB: MainModule['xphoto_GrayworldWB'] & StaticMembers<MainModule['xphoto_WhiteBalancer']> & StaticMembers<MainModule['Algorithm']>
/**
   * More sophisticated learning-based automatic white balance algorithm.
   *
   * As `GrayworldWB`, this algorithm works by applying different gains to the input
   * image channels, but their computation is a bit more involved compared to the
   * simple gray-world assumption. More details about the algorithm can be found in
   * [Cheng2015] .
   *
   * To mask out saturated pixels this function uses only pixels that satisfy the
   * following condition:
   *
   * ```math
   *  \frac{\textrm{max}(R,G,B)}{\texttt{range_max_val}} < \texttt{saturation_thresh} 
   * ```
   *
   * Currently supports images of type `CV_8UC3` and `CV_16UC3.`
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xphoto/include/opencv2/xphoto/white_balance.hpp#L168
   */
  xphoto_LearningBasedWB: MainModule['xphoto_LearningBasedWB'] & StaticMembers<MainModule['xphoto_WhiteBalancer']> & StaticMembers<MainModule['Algorithm']>
/**
   * This interface class allows to build new Layers - are building blocks of networks.
   *
   * Each class, derived from Layer, must implement forward() method to compute outputs.
   * Also before using the new layer into networks you must register your layer by using one of `dnnLayerFactory` "LayerFactory" macros.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/dnn.hpp#L270
   */
  dnn_Layer: MainModule['dnn_Layer'] & StaticMembers<MainModule['Algorithm']>
/**
   * This class represents high-level API for classification models.
   *
   * ClassificationModel allows to set params for preprocessing input image.
   * ClassificationModel creates net from file with trained weights and config,
   * sets preprocessing input, runs forward pass and return top-1 prediction.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/dnn.hpp#L1639
   */
  dnn_ClassificationModel: MainModule['dnn_ClassificationModel'] & StaticMembers<MainModule['dnn_Model']>
/**
   * This class represents high-level API for keypoints models
   *
   * KeypointsModel allows to set params for preprocessing input image.
   * KeypointsModel creates net from file with trained weights and config,
   * sets preprocessing input, runs forward pass and returns the x and y coordinates of each detected keypoint
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/dnn.hpp#L1692
   */
  dnn_KeypointsModel: MainModule['dnn_KeypointsModel'] & StaticMembers<MainModule['dnn_Model']>
/**
   * This class represents high-level API for segmentation  models
   *
   * SegmentationModel allows to set params for preprocessing input image.
   * SegmentationModel creates net from file with trained weights and config,
   * sets preprocessing input, runs forward pass and returns the class prediction for each pixel.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/dnn.hpp#L1724
   */
  dnn_SegmentationModel: MainModule['dnn_SegmentationModel'] & StaticMembers<MainModule['dnn_Model']>
/**
   * This class represents high-level API for object detection networks.
   *
   * DetectionModel allows to set params for preprocessing input image.
   * DetectionModel creates net from file with trained weights and config,
   * sets preprocessing input, runs forward pass and return result detections.
   * For DetectionModel SSD, Faster R-CNN, YOLO topologies are supported.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/dnn.hpp#L1755
   */
  dnn_DetectionModel: MainModule['dnn_DetectionModel'] & StaticMembers<MainModule['dnn_Model']>
/**
   * This class represents high-level API for text recognition networks.
   *
   * TextRecognitionModel allows to set params for preprocessing input image.
   * TextRecognitionModel creates net from file with trained weights and config,
   * sets preprocessing input, runs forward pass and return recognition result.
   * For TextRecognitionModel, CRNN-CTC is supported.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/dnn.hpp#L1810
   */
  dnn_TextRecognitionModel: MainModule['dnn_TextRecognitionModel'] & StaticMembers<MainModule['dnn_Model']>
/**
   * Base class for text detection networks
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/dnn.hpp#L1893
   */
  dnn_TextDetectionModel: MainModule['dnn_TextDetectionModel'] & StaticMembers<MainModule['dnn_Model']>
/**
   * This class represents high-level API for text detection DL networks compatible with EAST model.
   *
   * Configurable parameters:
   * - (float) confThreshold - used to filter boxes by confidences, default: 0.5f
   * - (float) nmsThreshold - used in non maximum suppression, default: 0.0f
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/dnn.hpp#L1966
   */
  dnn_TextDetectionModel_EAST: MainModule['dnn_TextDetectionModel_EAST'] & StaticMembers<MainModule['dnn_TextDetectionModel']> & StaticMembers<MainModule['dnn_Model']>
/**
   * This class represents high-level API for text detection DL networks compatible with DB model.
   *
   * Related publications: [liao2020real]
   * Paper: https://arxiv.org/abs/1911.08947
   * For more information about the hyper-parameters setting, please refer to https://github.com/MhLiao/DB
   *
   * Configurable parameters:
   * - (float) binaryThreshold - The threshold of the binary map. It is usually set to 0.3.
   * - (float) polygonThreshold - The threshold of text polygons. It is usually set to 0.5, 0.6, and 0.7. Default is 0.5f
   * - (double) unclipRatio - The unclip ratio of the detected text region, which determines the output size. It is usually set to 2.0.
   * - (int) maxCandidates - The max number of the output results.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/dnn.hpp#L2027
   */
  dnn_TextDetectionModel_DB: MainModule['dnn_TextDetectionModel_DB'] & StaticMembers<MainModule['dnn_TextDetectionModel']> & StaticMembers<MainModule['dnn_Model']>
/**
   * Base Classes ***********************************
   * Abstract base class for 2D image feature detectors and descriptor extractors
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/features/include/opencv2/features.hpp#L227
   */
  Feature2D: MainModule['Feature2D'] & StaticMembers<MainModule['Algorithm']>
/**
   * Class for implementing the wrapper which makes detectors and extractors to be affine invariant,
   * described as ASIFT in [YM11] .
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/features/include/opencv2/features.hpp#L327
   */
  AffineFeature: MainModule['AffineFeature'] & StaticMembers<MainModule['Feature2D']> & StaticMembers<MainModule['Algorithm']>
/**
   * Class for extracting keypoints and computing descriptors using the Scale Invariant Feature Transform
   * (SIFT) algorithm by D. Lowe [Lowe04] .
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/features/include/opencv2/features.hpp#L352
   */
  SIFT: MainModule['SIFT'] & StaticMembers<MainModule['Feature2D']> & StaticMembers<MainModule['Algorithm']>
/**
   * Class implementing the ORB (*oriented BRIEF*) keypoint detector and descriptor extractor
   *
   * described in [RRKB11] . The algorithm uses FAST in pyramids to detect stable keypoints, selects
   * the strongest features using FAST or Harris response, finds their orientation using first-order
   * moments and computes the descriptors using BRIEF (where the coordinates of random point pairs (or
   * k-tuples) are rotated according to the measured orientation).
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/features/include/opencv2/features.hpp#L444
   */
  ORB: MainModule['ORB'] & StaticMembers<MainModule['Feature2D']> & StaticMembers<MainModule['Algorithm']>
/**
   * example: samples/python/snippets/mser.py
   * An example using Maximally stable extremal region(MSER) extractor in python
   * Maximally stable extremal region extractor
   *
   * The class encapsulates all the parameters of the %MSER extraction algorithm (see [wiki
   * article](http://en.wikipedia.org/wiki/Maximally_stable_extremal_regions)).
   *
   * - there are two different implementation of %MSER: one for grey image, one for color image
   *
   * - the grey image algorithm is taken from: [nister2008linear] ;  the paper claims to be faster
   * than union-find method; it actually get 1.5~2m/s on my centrino L7200 1.2GHz laptop.
   *
   * - the color image algorithm is taken from: [forssen2007maximally] ; it should be much slower
   * than grey image method ( 3~4 times )
   *
   * - (Python) A complete example showing the use of the %MSER detector can be found at samples/python/mser.py
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/features/include/opencv2/features.hpp#L532
   */
  MSER: MainModule['MSER'] & StaticMembers<MainModule['Feature2D']> & StaticMembers<MainModule['Algorithm']>
/**
   * Wrapping class for feature detection using the FAST method.
   *
   * Check `tutorial_py_fast` "the corresponding tutorial" for more details.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/features/include/opencv2/features.hpp#L600
   */
  FastFeatureDetector: MainModule['FastFeatureDetector'] & StaticMembers<MainModule['Feature2D']> & StaticMembers<MainModule['Algorithm']>
/**
   * Wrapping class for feature detection using the goodFeaturesToTrack function. :
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/features/include/opencv2/features.hpp#L649
   */
  GFTTDetector: MainModule['GFTTDetector'] & StaticMembers<MainModule['Feature2D']> & StaticMembers<MainModule['Algorithm']>
/**
   * DISK feature detector and descriptor, based on a DNN model.
   *
   * DISK (Deep Image Structure and Keypoints) is a learned local-feature pipeline that produces
   * keypoints and 128-D L2-normalized descriptors via a single forward pass through a fully
   * convolutional network. This class wraps an ONNX export of the pre-trained DISK model through
   * cv::dnn::Net and exposes it under the standard cv::Feature2D interface so it can be used as
   * a drop-in alternative to SIFT/ORB.
   *
   * The class assumes the ONNX model has a single input named `image` taking an N×3×H×W float32
   * tensor in [0, 1] (RGB channel order) and three outputs named `keypoints` (N×2), `scores` (N)
   * and `descriptors` (N×128).
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/features/include/opencv2/features.hpp#L694
   */
  DISK: MainModule['DISK'] & StaticMembers<MainModule['Feature2D']> & StaticMembers<MainModule['Algorithm']>
/**
   * HAVE_OPENCV_DNN || CV_DOXYGEN
   * Class for extracting blobs from an image. :
   *
   * The class implements a simple algorithm for extracting blobs from an image:
   *
   * 1.  Convert the source image to binary images by applying thresholding with several thresholds from
   *     minThreshold (inclusive) to maxThreshold (exclusive) with distance thresholdStep between
   *     neighboring thresholds.
   * 2.  Extract connected components from every binary image by findContours and calculate their
   *     centers.
   * 3.  Group centers from several binary images by their coordinates. Close centers form one group that
   *     corresponds to one blob, which is controlled by the minDistBetweenBlobs parameter.
   * 4.  From the groups, estimate final centers of blobs and their radiuses and return as locations and
   *     sizes of keypoints.
   *
   * This class performs several filtrations of returned blobs. You should set filterBy\* to true/false
   * to turn on/off corresponding filtration. Available filtrations:
   *
   * -   **By color**. This filter compares the intensity of a binary image at the center of a blob to
   * blobColor. If they differ, the blob is filtered out. Use blobColor = 0 to extract dark blobs
   * and blobColor = 255 to extract light blobs.
   * -   **By area**. Extracted blobs have an area between minArea (inclusive) and maxArea (exclusive).
   * -   **By circularity**. Extracted blobs have circularity
   * (`\frac{4*\pi*Area}{perimeter * perimeter}`) between minCircularity (inclusive) and
   * maxCircularity (exclusive).
   * -   **By ratio of the minimum inertia to maximum inertia**. Extracted blobs have this ratio
   * between minInertiaRatio (inclusive) and maxInertiaRatio (exclusive).
   * -   **By convexity**. Extracted blobs have convexity (area / area of blob convex hull) between
   * minConvexity (inclusive) and maxConvexity (exclusive).
   *
   * Default values of parameters are tuned to extract dark circular blobs.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/features/include/opencv2/features.hpp#L789
   */
  SimpleBlobDetector: MainModule['SimpleBlobDetector'] & StaticMembers<MainModule['Feature2D']> & StaticMembers<MainModule['Algorithm']> & {
/**
   * simple blob detector params value in the OpenCV API.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/features/include/opencv2/features.hpp#L792
   */
 Params: MainModule['SimpleBlobDetector_Params']
 }
/**
   * ALIKED feature detector and descriptor extractor.
   *
   * ALIKED (A Lightweight Image KEYpoint Detector) is a CNN-based feature detector and descriptor
   * extractor, as described in [Zhao23] . It produces 128-dimensional float descriptors and
   * keypoints with sub-pixel accuracy.
   *
   * The model expects RGB input [1,3,H,W] and internally converts BGR images to RGB.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/features/include/opencv2/features.hpp#L850
   */
  ALIKED: MainModule['ALIKED'] & StaticMembers<MainModule['Feature2D']> & StaticMembers<MainModule['Algorithm']> & {
/**
   * aliked params value in the OpenCV API.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/features/include/opencv2/features.hpp#L857
   */
 Params: MainModule['ALIKED_Params']
 }
/**
   * features_main
   * \
   *                                  DescriptorMatcher                                     *
   * \***************************************************************************************
   *
   * Abstract base class for matching keypoint descriptors.
   *
   * It has two groups of match methods: for matching descriptors of an image with another image or with
   * an image set.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/features/include/opencv2/features.hpp#L960
   */
  DescriptorMatcher: MainModule['DescriptorMatcher'] & StaticMembers<MainModule['Algorithm']>
/**
   * Brute-force descriptor matcher.
   *
   * For each descriptor in the first set, this matcher finds the closest descriptor in the second set
   * by trying each one. This descriptor matcher supports masking permissible matches of descriptor
   * sets.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/features/include/opencv2/features.hpp#L1212
   */
  BFMatcher: MainModule['BFMatcher'] & StaticMembers<MainModule['DescriptorMatcher']> & StaticMembers<MainModule['Algorithm']>
/**
   * Flann-based descriptor matcher.
   *
   * This matcher trains cv::flann::Index on a train descriptor collection and calls its nearest search
   * methods to find the best matches. So, this matcher may be faster when matching a large train
   * collection than the brute force matcher. FlannBasedMatcher does not support masking permissible
   * matches of descriptor sets because flann::Index does not support this. :
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/features/include/opencv2/features.hpp#L1259
   */
  FlannBasedMatcher: MainModule['FlannBasedMatcher'] & StaticMembers<MainModule['DescriptorMatcher']> & StaticMembers<MainModule['Algorithm']>
/**
   * LightGlue feature matcher.
   *
   * LightGlue is a CNN-based feature matcher, as described in [Lindenberger23] . It takes
   * keypoint locations and descriptors from two images and directly predicts match pairs. Unlike
   * traditional matchers that compute descriptor distances, LightGlue uses attention mechanisms
   * to produce confidence scores for each potential match pair.
   *
   * The matcher extends DescriptorMatcher and supports the standard match(), knnMatch(), and
   * radiusMatch() interfaces. Context (keypoints and image sizes) must be provided via
   * setPairInfo() before matching.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/features/include/opencv2/features.hpp#L1310
   */
  LightGlueMatcher: MainModule['LightGlueMatcher'] & StaticMembers<MainModule['DescriptorMatcher']> & StaticMembers<MainModule['Algorithm']>
/**
   * freetype free type2 value in the OpenCV API.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/freetype/include/opencv2/freetype.hpp#L74
   */
  freetype_FreeType2: MainModule['freetype_FreeType2'] & StaticMembers<MainModule['Algorithm']>
/**
   * The opencv hfs module contains an efficient algorithm to segment an image.
   * This module is implemented based on the paper Hierarchical Feature Selection for Efficient
   * Image Segmentation, ECCV 2016. The original project was developed by
   * Yun Liu(https://github.com/yun-liu/hfs).
   *
   * Introduction to Hierarchical Feature Selection
   * ----------------------------------------------
   *
   * This algorithm is executed in 3 stages:
   *
   * In the first stage, the algorithm uses SLIC (simple linear iterative clustering) algorithm
   * to obtain the superpixel of the input image.
   *
   * In the second stage, the algorithm view each superpixel as a node in the graph.
   * It will calculate a feature vector for each edge of the graph. It then calculates a weight
   * for each edge based on the feature vector and trained SVM parameters. After obtaining
   * weight for each edge, it will exploit  EGB (Efficient Graph-based Image Segmentation)
   * algorithm to merge some nodes in the graph thus obtaining a coarser segmentation
   * After these operations, a post process will be executed to merge regions that are smaller
   * then a specific number of pixels into their nearby region.
   *
   * In the third stage, the algorithm exploits the similar mechanism to further merge
   * the small regions obtained in the second stage into even coarser segmentation.
   *
   * After these three stages, we can obtain the final segmentation of the image.
   * For further details about the algorithm, please refer to the original paper:
   * Hierarchical Feature Selection for Efficient Image Segmentation, ECCV 2016
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/hfs/include/opencv2/hfs.hpp#L45
   */
  hfs_HfsSegment: MainModule['hfs_HfsSegment'] & StaticMembers<MainModule['Algorithm']>
/**
   * Computes average hash value of the input image
   *
   * This is a fast image hashing algorithm, but only work on simple case. For more details, please
   * refer to [lookslikeit]
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/img_hash/include/opencv2/img_hash/average_hash.hpp#L21
   */
  img_hash_AverageHash: MainModule['img_hash_AverageHash'] & StaticMembers<MainModule['img_hash_ImgHashBase']> & StaticMembers<MainModule['Algorithm']>
/**
   * Image hash based on block mean.
   *
   * See [zauner2010implementation] for details.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/img_hash/include/opencv2/img_hash/block_mean_hash.hpp#L26
   */
  img_hash_BlockMeanHash: MainModule['img_hash_BlockMeanHash'] & StaticMembers<MainModule['img_hash_ImgHashBase']> & StaticMembers<MainModule['Algorithm']>
/**
   * Image hash based on color moments.
   *
   * See [tang2012perceptual] for details.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/img_hash/include/opencv2/img_hash/color_moment_hash.hpp#L20
   */
  img_hash_ColorMomentHash: MainModule['img_hash_ColorMomentHash'] & StaticMembers<MainModule['img_hash_ImgHashBase']> & StaticMembers<MainModule['Algorithm']>
/**
   * The base class for image hash algorithms
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/img_hash/include/opencv2/img_hash/img_hash_base.hpp#L18
   */
  img_hash_ImgHashBase: MainModule['img_hash_ImgHashBase'] & StaticMembers<MainModule['Algorithm']>
/**
   * Marr-Hildreth Operator Based Hash, slowest but more discriminative.
   *
   * See [zauner2010implementation] for details.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/img_hash/include/opencv2/img_hash/marr_hildreth_hash.hpp#L20
   */
  img_hash_MarrHildrethHash: MainModule['img_hash_MarrHildrethHash'] & StaticMembers<MainModule['img_hash_ImgHashBase']> & StaticMembers<MainModule['Algorithm']>
/**
   * pHash
   *
   * Slower than average_hash, but tolerant of minor modifications
   *
   * This algorithm can combat more variation than averageHash, for more details please refer to [lookslikeit]
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/img_hash/include/opencv2/img_hash/phash.hpp#L22
   */
  img_hash_PHash: MainModule['img_hash_PHash'] & StaticMembers<MainModule['img_hash_ImgHashBase']> & StaticMembers<MainModule['Algorithm']>
/**
   * Image hash based on Radon transform.
   *
   * See [tang2012perceptual] for details.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/img_hash/include/opencv2/img_hash/radial_variance_hash.hpp#L21
   */
  img_hash_RadialVarianceHash: MainModule['img_hash_RadialVarianceHash'] & StaticMembers<MainModule['img_hash_ImgHashBase']> & StaticMembers<MainModule['Algorithm']>
/**
   * Class implements both functionalities for detection of lines and computation of their
   * binary descriptor.
   *
   * Class' interface is mainly based on the ones of classical detectors and extractors, such as
   * Feature2d's `features_main` and `features_match.` Retrieved information about lines is
   * stored in line_descriptor::KeyLine objects.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/line_descriptor/include/opencv2/line_descriptor/descriptor.hpp#L182
   */
  line_descriptor_BinaryDescriptor: MainModule['line_descriptor_BinaryDescriptor'] & StaticMembers<MainModule['Algorithm']>
/**
   * line descriptor lsddetector value in the OpenCV API.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/line_descriptor/include/opencv2/line_descriptor/descriptor.hpp#L924
   */
  line_descriptor_LSDDetector: MainModule['line_descriptor_LSDDetector'] & StaticMembers<MainModule['Algorithm']>
/**
   * furnishes all functionalities for querying a dataset provided by user or internal to
   * class (that user must, anyway, populate) on the model of `features_match`
   *
   * Once descriptors have been extracted from an image (both they represent lines and points), it
   * becomes interesting to be able to match a descriptor with another one extracted from a different
   * image and representing the same line or point, seen from a differente perspective or on a different
   * scale. In reaching such goal, the main headache is designing an efficient search algorithm to
   * associate a query descriptor to one extracted from a dataset. In the following, a matching modality
   * based on *Multi-Index Hashing (MiHashing)* will be described.
   *
   * Multi-Index Hashing
   * -------------------
   *
   * The theory described in this section is based on [MIH] . Given a dataset populated with binary
   * codes, each code is indexed *m* times into *m* different hash tables, according to *m* substrings it
   * has been divided into. Thus, given a query code, all the entries close to it at least in one
   * substring are returned by search as *neighbor candidates*. Returned entries are then checked for
   * validity by verifying that their full codes are not distant (in Hamming space) more than *r* bits
   * from query code. In details, each binary code **h** composed of *b* bits is divided into *m*
   * disjoint substrings `\mathbf{h}^{(1)}, ..., \mathbf{h}^{(m)}`, each with length
   * `\lfloor b/m \rfloor` or `\lceil b/m \rceil` bits. Formally, when two codes **h** and **g** differ
   * by at the most *r* bits, in at the least one of their *m* substrings they differ by at the most
   * `\lfloor r/m \rfloor` bits. In particular, when `||\mathbf{h}-\mathbf{g}||_H \le r` (where `||.||_H`
   * is the Hamming norm), there must exist a substring *k* (with `1 \le k \le m`) such that
   *
   * ```math
   * ||\mathbf{h}^{(k)} - \mathbf{g}^{(k)}||_H \le \left\lfloor \frac{r}{m} \right\rfloor .
   * ```
   *
   * That means that if Hamming distance between each of the *m* substring is strictly greater than
   * `\lfloor r/m \rfloor`, then `||\mathbf{h}-\mathbf{g}||_H` must be larger that *r* and that is a
   * contradiction. If the codes in dataset are divided into *m* substrings, then *m* tables will be
   * built. Given a query **q** with substrings `\{\mathbf{q}^{(i)}\}^m_{i=1}`, *i*-th hash table is
   * searched for entries distant at the most `\lfloor r/m \rfloor` from `\mathbf{q}^{(i)}` and a set of
   * candidates `\mathcal{N}_i(\mathbf{q})` is obtained. The union of sets
   * `\mathcal{N}(\mathbf{q}) = \bigcup_i \mathcal{N}_i(\mathbf{q})` is a superset of the *r*-neighbors
   * of **q**. Then, last step of algorithm is computing the Hamming distance between **q** and each
   * element in `\mathcal{N}(\mathbf{q})`, deleting the codes that are distant more that *r* from **q**.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/line_descriptor/include/opencv2/line_descriptor/descriptor.hpp#L1019
   */
  line_descriptor_BinaryDescriptorMatcher: MainModule['line_descriptor_BinaryDescriptorMatcher'] & StaticMembers<MainModule['Algorithm']>
/**
   * QR code detector.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/objdetect/include/opencv2/objdetect.hpp#L219
   */
  QRCodeDetector: MainModule['QRCodeDetector'] & StaticMembers<MainModule['GraphicalCodeDetector']>
/**
   * QR code detector based on Aruco markers detection code.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/objdetect/include/opencv2/objdetect.hpp#L268
   */
  QRCodeDetectorAruco: MainModule['QRCodeDetectorAruco'] & StaticMembers<MainModule['GraphicalCodeDetector']> & {
/**
   * qrcode detector aruco params value in the OpenCV API.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/objdetect/include/opencv2/objdetect.hpp#L272
   */
 Params: MainModule['QRCodeDetectorAruco_Params']
 }
/**
   * Planar board with grid arrangement of markers
   *
   * More common type of board. All markers are placed in the same plane in a grid arrangement.
   * The board image can be drawn using generateImage() method.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/objdetect/include/opencv2/objdetect/aruco_board.hpp#L107
   */
  aruco_GridBoard: MainModule['aruco_GridBoard'] & StaticMembers<MainModule['aruco_Board']>
/**
   * ChArUco board is a planar chessboard where the markers are placed inside the white squares of a chessboard.
   *
   * The benefits of ChArUco boards is that they provide both, ArUco markers versatility and chessboard corner precision,
   * which is important for calibration and pose estimation. The board image can be drawn using generateImage() method.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/objdetect/include/opencv2/objdetect/aruco_board.hpp#L135
   */
  aruco_CharucoBoard: MainModule['aruco_CharucoBoard'] & StaticMembers<MainModule['aruco_Board']>
/**
   * The main functionality of ArucoDetector class is detection of markers in an image with detectMarkers() method.
   *
   * After detecting some markers in the image, you can try to find undetected markers from this dictionary with
   * refineDetectedMarkers() method.
   *
   * See: DetectorParameters, RefineParameters
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/objdetect/include/opencv2/objdetect/aruco_detector.hpp#L281
   */
  aruco_ArucoDetector: MainModule['aruco_ArucoDetector'] & StaticMembers<MainModule['Algorithm']>
/**
   * barcode barcode detector value in the OpenCV API.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/objdetect/include/opencv2/objdetect/barcode.hpp#L18
   */
  barcode_BarcodeDetector: MainModule['barcode_BarcodeDetector'] & StaticMembers<MainModule['GraphicalCodeDetector']>
/**
   * aruco charuco detector value in the OpenCV API.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/objdetect/include/opencv2/objdetect/charuco_detector.hpp#L37
   */
  aruco_CharucoDetector: MainModule['aruco_CharucoDetector'] & StaticMembers<MainModule['Algorithm']>
/**
   * CChecker
   *
   * checker object
   *
   *     This class contains the information about the detected checkers,i.e, their
   *     type, the corners of the chart, the color profile, the cost, centers chart,
   *     etc.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/objdetect/include/opencv2/objdetect/mcc_checker_detector.hpp#L67
   */
  mcc_CChecker: MainModule['mcc_CChecker'] & StaticMembers<MainModule['Algorithm']>
/**
   * A class to find the positions of the ColorCharts in the image.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/objdetect/include/opencv2/objdetect/mcc_checker_detector.hpp#L190
   */
  mcc_CCheckerDetector: MainModule['mcc_CCheckerDetector'] & StaticMembers<MainModule['Algorithm']>
/**
   * Saliency Base Class ***********************************
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/saliency/include/opencv2/saliency/saliencyBaseClasses.hpp#L62
   */
  saliency_Saliency: MainModule['saliency_Saliency'] & StaticMembers<MainModule['Algorithm']>
/**
   * Static Saliency Base Class ***********************************
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/saliency/include/opencv2/saliency/saliencyBaseClasses.hpp#L85
   */
  saliency_StaticSaliency: MainModule['saliency_StaticSaliency'] & StaticMembers<MainModule['saliency_Saliency']> & StaticMembers<MainModule['Algorithm']>
/**
   * Motion Saliency Base Class ***********************************
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/saliency/include/opencv2/saliency/saliencyBaseClasses.hpp#L111
   */
  saliency_MotionSaliency: MainModule['saliency_MotionSaliency'] & StaticMembers<MainModule['saliency_Saliency']> & StaticMembers<MainModule['Algorithm']>
/**
   * Objectness Base Class ***********************************
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/saliency/include/opencv2/saliency/saliencyBaseClasses.hpp#L120
   */
  saliency_Objectness: MainModule['saliency_Objectness'] & StaticMembers<MainModule['saliency_Saliency']> & StaticMembers<MainModule['Algorithm']>
/**
   * Specific Static Saliency Specialized Classes ***********************************
   * the Spectral Residual approach from  [SR]
   *
   * Starting from the principle of natural image statistics, this method simulate the behavior of
   * pre-attentive visual search. The algorithm analyze the log spectrum of each image and obtain the
   * spectral residual. Then transform the spectral residual to spatial domain to obtain the saliency
   * map, which suggests the positions of proto-objects.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/saliency/include/opencv2/saliency/saliencySpecializedClasses.hpp#L69
   */
  saliency_StaticSaliencySpectralResidual: MainModule['saliency_StaticSaliencySpectralResidual'] & StaticMembers<MainModule['saliency_StaticSaliency']> & StaticMembers<MainModule['saliency_Saliency']> & StaticMembers<MainModule['Algorithm']>
/**
   * the Fine Grained Saliency approach from [FGS]
   *
   * This method calculates saliency based on center-surround differences.
   * High resolution saliency maps are generated in real time by using integral images.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/saliency/include/opencv2/saliency/saliencySpecializedClasses.hpp#L122
   */
  saliency_StaticSaliencyFineGrained: MainModule['saliency_StaticSaliencyFineGrained'] & StaticMembers<MainModule['saliency_StaticSaliency']> & StaticMembers<MainModule['saliency_Saliency']> & StaticMembers<MainModule['Algorithm']>
/**
   * Specific Motion Saliency Specialized Classes ***********************************
   * A Fast Self-tuning Background Subtraction Algorithm.
   *
   * This background subtraction algorithm is inspired to the work of B. Wang and P. Dudek [2]
   * [2]  B. Wang and P. Dudek "A Fast Self-tuning Background Subtraction Algorithm", in proc of IEEE Workshop on Change Detection, 2014
   *
   * the Fast Self-tuning Background Subtraction Algorithm from [BinWangApr2014]
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/saliency/include/opencv2/saliency/saliencySpecializedClasses.hpp#L169
   */
  saliency_MotionSaliencyBinWangApr2014: MainModule['saliency_MotionSaliencyBinWangApr2014'] & StaticMembers<MainModule['saliency_MotionSaliency']> & StaticMembers<MainModule['saliency_Saliency']> & StaticMembers<MainModule['Algorithm']>
/**
   * Specific Objectness Specialized Classes ***********************************
   * Objectness algorithms based on [3]
   * [3] Cheng, Ming-Ming, et al. "BING: Binarized normed gradients for objectness estimation at 300fps." IEEE CVPR. 2014.
   * the Binarized normed gradients algorithm from [BING]
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/saliency/include/opencv2/saliency/saliencySpecializedClasses.hpp#L291
   */
  saliency_ObjectnessBING: MainModule['saliency_ObjectnessBING'] & StaticMembers<MainModule['saliency_Objectness']> & StaticMembers<MainModule['saliency_Saliency']> & StaticMembers<MainModule['Algorithm']>
/**
   * Base class for 1st and 2nd stages of Neumann and Matas scene text detection algorithm [Neumann12]. :
   *
   * Extracts the component tree (if needed) and filter the extremal regions (ER's) by using a given classifier.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/text/include/opencv2/text/erfilter.hpp#L118
   */
  text_ERFilter: MainModule['text_ERFilter'] & StaticMembers<MainModule['Algorithm']> & {
/**
   * Callback with the classifier is made a class.
   *
   *     By doing it we hide SVM, Boost etc. Developers can provide their own classifiers to the
   *     ERFilter algorithm.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/text/include/opencv2/text/erfilter.hpp#L127
   */
 Callback: MainModule['text_ERFilter_Callback']
 }
/**
   * OCRTesseract class provides an interface with the tesseract-ocr API (v3.02.02) in C++.
   *
   * Notice that it is compiled only when tesseract-ocr is correctly installed.
   *
   * **Note:** -   (C++) An example of OCRTesseract recognition combined with scene text detection can be found
   *         at the end_to_end_recognition demo:
   *         <https://github.com/opencv/opencv_contrib/blob/master/modules/text/samples/end_to_end_recognition.cpp>
   *     -   (C++) Another example of OCRTesseract recognition combined with scene text detection can be
   *         found at the webcam_demo:
   *         <https://github.com/opencv/opencv_contrib/blob/master/modules/text/samples/webcam_demo.cpp>
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/text/include/opencv2/text/ocr.hpp#L116
   */
  text_OCRTesseract: MainModule['text_OCRTesseract'] & StaticMembers<MainModule['text_BaseOCR']>
/**
   * OCRHMMDecoder class provides an interface for OCR using Hidden Markov Models.
   *
   * **Note:** -   (C++) An example on using OCRHMMDecoder recognition combined with scene text detection can
   *         be found at the webcam_demo sample:
   *         <https://github.com/opencv/opencv_contrib/blob/master/modules/text/samples/webcam_demo.cpp>
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/text/include/opencv2/text/ocr.hpp#L193
   */
  text_OCRHMMDecoder: MainModule['text_OCRHMMDecoder'] & StaticMembers<MainModule['text_BaseOCR']> & {
/**
   * Callback with the character classifier is made a class.
   *
   *     This way it hides the feature extractor and the classifier itself, so developers can write
   *     their own OCR code.
   *
   *     The default character classifier and feature extractor can be loaded using the utility function
   *     loadOCRHMMClassifierNM and KNN model provided in
   *     <https://github.com/opencv/opencv_contrib/blob/master/modules/text/samples/OCRHMM_knn_model_data.xml.gz>.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/text/include/opencv2/text/ocr.hpp#L206
   */
 ClassifierCallback: MainModule['text_OCRHMMDecoder_ClassifierCallback']
 }
/**
   * OCR BeamSearch Decoder
   * OCRBeamSearchDecoder class provides an interface for OCR using Beam Search algorithm.
   *
   * **Note:** -   (C++) An example on using OCRBeamSearchDecoder recognition combined with scene text detection can
   *         be found at the demo sample:
   *         <https://github.com/opencv/opencv_contrib/blob/master/modules/text/samples/word_recognition.cpp>
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/text/include/opencv2/text/ocr.hpp#L394
   */
  text_OCRBeamSearchDecoder: MainModule['text_OCRBeamSearchDecoder'] & StaticMembers<MainModule['text_BaseOCR']> & {
/**
   * Callback with the character classifier is made a class.
   *
   *     This way it hides the feature extractor and the classifier itself, so developers can write
   *     their own OCR code.
   *
   *     The default character classifier and feature extractor can be loaded using the utility function
   *     loadOCRBeamSearchClassifierCNN with all its parameters provided in
   *     <https://github.com/opencv/opencv_contrib/blob/master/modules/text/samples/OCRBeamSearch_CNN_model_data.xml.gz>.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/text/include/opencv2/text/ocr.hpp#L407
   */
 ClassifierCallback: MainModule['text_OCRBeamSearchDecoder_ClassifierCallback']
 }
/**
   * TextDetectorCNN class provides the functionallity of text bounding box detection.
   *  This class is representing to find bounding boxes of text words given an input image.
   *  This class uses OpenCV dnn module to load pre-trained model described in [LiaoSBWL17].
   *  The original repository with the modified SSD Caffe version: https://github.com/MhLiao/TextBoxes.
   *  Model can be downloaded from [DropBox](https://www.dropbox.com/s/g8pjzv2de9gty8g/TextBoxes_icdar13.caffemodel?dl=0).
   *  Modified .prototxt file with the model description can be found in `opencv_contrib/modules/text/samples/textbox.prototxt`.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/text/include/opencv2/text/textDetector.hpp#L41
   */
  text_TextDetectorCNN: MainModule['text_TextDetectorCNN'] & StaticMembers<MainModule['text_TextDetector']>
/**
   * Base class for background/foreground segmentation. :
   *
   * The class is only used to define the common interface for the whole family of background/foreground
   * segmentation algorithms.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/video/include/opencv2/video/background_segm.hpp#L60
   */
  BackgroundSubtractor: MainModule['BackgroundSubtractor'] & StaticMembers<MainModule['Algorithm']>
/**
   * Gaussian Mixture-based Background/Foreground Segmentation Algorithm.
   *
   * The class implements the Gaussian mixture model background subtraction described in [Zivkovic2004]
   * and [Zivkovic2006] .
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/video/include/opencv2/video/background_segm.hpp#L105
   */
  BackgroundSubtractorMOG2: MainModule['BackgroundSubtractorMOG2'] & StaticMembers<MainModule['BackgroundSubtractor']> & StaticMembers<MainModule['Algorithm']>
/**
   * K-nearest neighbours - based Background/Foreground Segmentation Algorithm.
   *
   * The class implements the K-nearest neighbours background subtraction described in [Zivkovic2006] .
   * Very efficient if number of foreground pixels is low.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/video/include/opencv2/video/background_segm.hpp#L256
   */
  BackgroundSubtractorKNN: MainModule['BackgroundSubtractorKNN'] & StaticMembers<MainModule['BackgroundSubtractor']> & StaticMembers<MainModule['Algorithm']>
/**
   * example: samples/python/snippets/dis_opt_flow.py
   * An example using the dense optical flow and DIS optical flow algorithms in python
   * example: samples/cpp/snippets/dis_opticalflow.cpp
   * An example using the dense optical flow and DIS optical flow algorithms
   * Base class for dense optical flow algorithms
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/video/include/opencv2/video/tracking.hpp#L614
   */
  DenseOpticalFlow: MainModule['DenseOpticalFlow'] & StaticMembers<MainModule['Algorithm']>
/**
   * Base interface for sparse optical flow algorithms.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/video/include/opencv2/video/tracking.hpp#L631
   */
  SparseOpticalFlow: MainModule['SparseOpticalFlow'] & StaticMembers<MainModule['Algorithm']>
/**
   * Class computing a dense optical flow using the Gunnar Farneback's algorithm.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/video/include/opencv2/video/tracking.hpp#L653
   */
  FarnebackOpticalFlow: MainModule['FarnebackOpticalFlow'] & StaticMembers<MainModule['DenseOpticalFlow']> & StaticMembers<MainModule['Algorithm']>
/**
   * Variational optical flow refinement
   *
   * This class implements variational refinement of the input flow field, i.e.
   * it uses input flow to initialize the minimization of the following functional:
   * `E(U) = \int_{\Omega} \delta \Psi(E_I) + \gamma \Psi(E_G) + \alpha \Psi(E_S) `,
   * where `E_I,E_G,E_S` are color constancy, gradient constancy and smoothness terms
   * respectively. `\Psi(s^2)=\sqrt{s^2+\epsilon^2}` is a robust penalizer to limit the
   * influence of outliers. A complete formulation and a description of the minimization
   * procedure can be found in [Brox2004]
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/video/include/opencv2/video/tracking.hpp#L701
   */
  VariationalRefinement: MainModule['VariationalRefinement'] & StaticMembers<MainModule['DenseOpticalFlow']> & StaticMembers<MainModule['Algorithm']>
/**
   * DIS optical flow algorithm.
   *
   * This class implements the Dense Inverse Search (DIS) optical flow algorithm. More
   * details about the algorithm can be found at [Kroeger2016] . Includes three presets with preselected
   * parameters to provide reasonable trade-off between speed and quality. However, even the slowest preset is
   * still relatively fast, use DeepFlow if you need better quality and don't care about speed.
   *
   * This implementation includes several additional features compared to the algorithm described in the paper,
   * including spatial propagation of flow vectors (`getUseSpatialPropagation`), as well as an option to
   * utilize an initial flow approximation passed to `calc` (which is, essentially, temporal propagation,
   * if the previous frame's flow field is passed).
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/video/include/opencv2/video/tracking.hpp#L768
   */
  DISOpticalFlow: MainModule['DISOpticalFlow'] & StaticMembers<MainModule['DenseOpticalFlow']> & StaticMembers<MainModule['Algorithm']>
/**
   * Class used for calculating a sparse optical flow.
   *
   * The class can calculate an optical flow for a sparse feature set using the
   * iterative Lucas-Kanade method with pyramids.
   *
   * See: calcOpticalFlowPyrLK
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/video/include/opencv2/video/tracking.hpp#L882
   */
  SparsePyrLKOpticalFlow: MainModule['SparsePyrLKOpticalFlow'] & StaticMembers<MainModule['SparseOpticalFlow']> & StaticMembers<MainModule['Algorithm']>
/**
   * The MIL algorithm trains a classifier in an online manner to separate the object from the
   * background.
   *
   * Multiple Instance Learning avoids the drift problem for a robust tracking. The implementation is
   * based on [MIL] .
   *
   * Original code can be found here <http://vision.ucsd.edu/~bbabenko/project_miltrack.shtml>
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/video/include/opencv2/video/tracking.hpp#L955
   */
  TrackerMIL: MainModule['TrackerMIL'] & StaticMembers<MainModule['Tracker']> & {
/**
   * tracker mil params value in the OpenCV API.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/video/include/opencv2/video/tracking.hpp#L962
   */
 Params: MainModule['TrackerMIL_Params']
 }
/**
   * tracker da siam rpn value in the OpenCV API.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/video/include/opencv2/video/tracking.hpp#L985
   */
  TrackerDaSiamRPN: MainModule['TrackerDaSiamRPN'] & StaticMembers<MainModule['Tracker']> & {
/**
   * tracker da siam rpn params value in the OpenCV API.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/video/include/opencv2/video/tracking.hpp#L992
   */
 Params: MainModule['TrackerDaSiamRPN_Params']
 }
/**
   * the Nano tracker is a super lightweight dnn-based general object tracking.
   *
   *  Nano tracker is much faster and extremely lightweight due to special model structure, the whole model size is about 1.9 MB.
   *  Nano tracker needs two models: one for feature extraction (backbone) and the another for localization (neckhead).
   *  Model download link: https://github.com/HonglinChu/SiamTrackers/tree/master/NanoTrack/models/nanotrackv2
   *  Original repo is here: https://github.com/HonglinChu/NanoTrack
   *  Author: HongLinChu, 1628464345qq:.com
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/video/include/opencv2/video/tracking.hpp#L1030
   */
  TrackerNano: MainModule['TrackerNano'] & StaticMembers<MainModule['Tracker']> & {
/**
   * tracker nano params value in the OpenCV API.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/video/include/opencv2/video/tracking.hpp#L1037
   */
 Params: MainModule['TrackerNano_Params']
 }
/**
   * the VIT tracker is a super lightweight dnn-based general object tracking.
   *
   *  VIT tracker is much faster and extremely lightweight due to special model structure, the model file is about 767KB.
   *  Model download link: https://github.com/opencv/opencv_zoo/tree/main/models/object_tracking_vittrack
   *  Author: PengyuLiu, 1872918507qq:.com
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/video/include/opencv2/video/tracking.hpp#L1071
   */
  TrackerVit: MainModule['TrackerVit'] & StaticMembers<MainModule['Tracker']> & {
/**
   * tracker vit params value in the OpenCV API.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/video/include/opencv2/video/tracking.hpp#L1078
   */
 Params: MainModule['TrackerVit_Params']
 }
/**
   * Position-Color-Texture signatures
   * Class implementing PCT (position-color-texture) signature extraction
   *       as described in [KrulisLS16].
   *       The algorithm is divided to a feature sampler and a clusterizer.
   *       Feature sampler produces samples at given set of coordinates.
   *       Clusterizer then produces clusters of these samples using k-means algorithm.
   *       Resulting set of clusters is the signature of the input image.
   *
   *       A signature is an array of SIGNATURE_DIMENSION-dimensional points.
   *       Used dimensions are:
   *       weight, x, y position; lab color, contrast, entropy.
   * [KrulisLS16]
   * [BeecksUS10]
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xfeatures2d/include/opencv2/xfeatures2d.hpp#L621
   */
  xfeatures2d_PCTSignatures: MainModule['xfeatures2d_PCTSignatures'] & StaticMembers<MainModule['Algorithm']>
/**
   * Class implementing Signature Quadratic Form Distance (SQFD).
   * See: Christian Beecks, Merih Seran Uysal, Thomas Seidl.
   *   Signature quadratic form distance.
   *   In Proceedings of the ACM International Conference on Image and Video Retrieval, pages 438-445.
   *   ACM, 2010.
   * [BeecksUS10]
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xfeatures2d/include/opencv2/xfeatures2d.hpp#L1034
   */
  xfeatures2d_PCTSignaturesSQFD: MainModule['xfeatures2d_PCTSignaturesSQFD'] & StaticMembers<MainModule['Algorithm']>
/**
   * Class implementing the Tree Based Morse Regions (TBMR) as described in
   * [Najman2014] extended with scaled extraction ability.
   *
   * **Note:** This algorithm is based on Component Tree (Min/Max) as well as MSER but
   * uses a Morse-theory approach to extract features.
   *
   * Features are ellipses (similar to MSER, however a MSER feature can never be a
   * TBMR feature and vice versa).
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xfeatures2d/include/opencv2/xfeatures2d.hpp#L1200
   */
  xfeatures2d_TBMR: MainModule['xfeatures2d_TBMR'] & StaticMembers<MainModule['xfeatures2d_AffineFeature2D']>
/**
   * kmeans -based class to train visual vocabulary using the *bag of visual words* approach. :
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xfeatures2d/include/opencv2/xfeatures2d.hpp#L1584
   */
  xfeatures2d_BOWKMeansTrainer: MainModule['xfeatures2d_BOWKMeansTrainer'] & StaticMembers<MainModule['xfeatures2d_BOWTrainer']>
/**
   * Main interface for all disparity map filters.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ximgproc/include/opencv2/ximgproc/disparity_filter.hpp#L52
   */
  ximgproc_DisparityFilter: MainModule['ximgproc_DisparityFilter'] & StaticMembers<MainModule['Algorithm']>
/**
   * Disparity map filter based on Weighted Least Squares filter (in form of Fast Global Smoother that
   * is a lot faster than traditional Weighted Least Squares filter implementations) and optional use of
   * left-right-consistency-based confidence to refine the results in half-occlusions and uniform areas.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ximgproc/include/opencv2/ximgproc/disparity_filter.hpp#L86
   */
  ximgproc_DisparityWLSFilter: MainModule['ximgproc_DisparityWLSFilter'] & StaticMembers<MainModule['ximgproc_DisparityFilter']> & StaticMembers<MainModule['Algorithm']>
/**
   * Class implementing the ED (EdgeDrawing) [topal2012edge], EDLines [akinlar2011edlines], EDPF [akinlar2012edpf], EDCircles [akinlar2013edcircles] and ColorED [akinlar201782] algorithms.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ximgproc/include/opencv2/ximgproc/edge_drawing.hpp#L21
   */
  ximgproc_EdgeDrawing: MainModule['ximgproc_EdgeDrawing'] & StaticMembers<MainModule['Algorithm']> & {
/**
   * ximgproc edge drawing params value in the OpenCV API.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ximgproc/include/opencv2/ximgproc/edge_drawing.hpp#L33
   */
 Params: MainModule['ximgproc_EdgeDrawing_Params']
 }
/**
   * Interface for realizations of Domain Transform filter.
   *
   * For more details about this filter see [Gastal11] .
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ximgproc/include/opencv2/ximgproc/edge_filter.hpp#L66
   */
  ximgproc_DTFilter: MainModule['ximgproc_DTFilter'] & StaticMembers<MainModule['Algorithm']>
/**
   * Interface for realizations of (Fast) Guided Filter.
   *
   * For more details about this filter see [Kaiming10] [Kaiming15] .
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ximgproc/include/opencv2/ximgproc/edge_filter.hpp#L130
   */
  ximgproc_GuidedFilter: MainModule['ximgproc_GuidedFilter'] & StaticMembers<MainModule['Algorithm']>
/**
   * Interface for Adaptive Manifold Filter realizations.
   *
   * For more details about this filter see [Gastal12] and References_.
   *
   * Below listed optional parameters which may be set up with Algorithm::set function.
   * -   member double sigma_s = 16.0
   * Spatial standard deviation.
   * -   member double sigma_r = 0.2
   * Color space standard deviation.
   * -   member int tree_height = -1
   * Height of the manifold tree (default = -1 : automatically computed).
   * -   member int num_pca_iterations = 1
   * Number of iterations to computed the eigenvector.
   * -   member bool adjust_outliers = false
   * Specify adjust outliers using Eq. 9 or not.
   * -   member bool use_RNG = true
   * Specify use random number generator to compute eigenvector or not.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ximgproc/include/opencv2/ximgproc/edge_filter.hpp#L209
   */
  ximgproc_AdaptiveManifoldFilter: MainModule['ximgproc_AdaptiveManifoldFilter'] & StaticMembers<MainModule['Algorithm']>
/**
   * Interface for implementations of Fast Bilateral Solver.
   *
   * For more details about this solver see [BarronPoole2016] .
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ximgproc/include/opencv2/ximgproc/edge_filter.hpp#L388
   */
  ximgproc_FastBilateralSolverFilter: MainModule['ximgproc_FastBilateralSolverFilter'] & StaticMembers<MainModule['Algorithm']>
/**
   * Interface for implementations of Fast Global Smoother filter.
   *
   * For more details about this filter see [Min2014] and [Farbman2008] .
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ximgproc/include/opencv2/ximgproc/edge_filter.hpp#L463
   */
  ximgproc_FastGlobalSmootherFilter: MainModule['ximgproc_FastGlobalSmootherFilter'] & StaticMembers<MainModule['Algorithm']>
/**
   * Class implementing EdgeBoxes algorithm from [ZitnickECCV14edgeBoxes] :
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ximgproc/include/opencv2/ximgproc/edgeboxes.hpp#L67
   */
  ximgproc_EdgeBoxes: MainModule['ximgproc_EdgeBoxes'] & StaticMembers<MainModule['Algorithm']>
/**
   * Class implementing the FLD (Fast Line Detector) algorithm described
   * in [Lee14] .
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ximgproc/include/opencv2/ximgproc/fast_line_detector.hpp#L24
   */
  ximgproc_FastLineDetector: MainModule['ximgproc_FastLineDetector'] & StaticMembers<MainModule['Algorithm']>
/**
   * Class for ContourFitting algorithms.
   *     ContourFitting match two contours ` z_a ` and ` z_b ` minimizing distance
   *     
   * ```math
   *  d(z_a,z_b)=\sum (a_n - s  b_n e^{j(n \alpha +\phi )})^2 
   * ```
   *  where ` a_n ` and ` b_n ` are Fourier descriptors of ` z_a ` and ` z_b ` and s is a scaling factor and  ` \phi ` is angle rotation and ` \alpha ` is starting point factor adjustement
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ximgproc/include/opencv2/ximgproc/fourier_descriptors.hpp#L20
   */
  ximgproc_ContourFitting: MainModule['ximgproc_ContourFitting'] & StaticMembers<MainModule['Algorithm']>
/**
   * Class implementing the LSC (Linear Spectral Clustering) superpixels
   * algorithm described in [LiCVPR2015LSC].
   *
   * LSC (Linear Spectral Clustering) produces compact and uniform superpixels with low
   * computational costs. Basically, a normalized cuts formulation of the superpixel
   * segmentation is adopted based on a similarity metric that measures the color
   * similarity and space proximity between image pixels. LSC is of linear computational
   * complexity and high memory efficiency and is able to preserve global properties of images
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ximgproc/include/opencv2/ximgproc/lsc.hpp#L71
   */
  ximgproc_SuperpixelLSC: MainModule['ximgproc_SuperpixelLSC'] & StaticMembers<MainModule['Algorithm']>
/**
   * Applies Ridge Detection Filter to an input image.
   * Implements Ridge detection similar to the one in [Mathematica](http://reference.wolfram.com/language/ref/RidgeFilter.html)
   * using the eigen values from the Hessian Matrix of the input image using Sobel Derivatives.
   * Additional refinement can be done using Skeletonization and Binarization. Adapted from [segleafvein] and [M_RF]
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ximgproc/include/opencv2/ximgproc/ridgefilter.hpp#L27
   */
  ximgproc_RidgeDetectionFilter: MainModule['ximgproc_RidgeDetectionFilter'] & StaticMembers<MainModule['Algorithm']>
/**
   * Class implementing the F-DBSCAN (Accelerated superpixel image segmentation with a parallelized DBSCAN algorithm) superpixels
   * algorithm by Loke SC, et al. [loke2021accelerated] for original paper.
   *
   * The algorithm uses a parallelised DBSCAN cluster search that is resistant to noise, competitive in segmentation quality, and faster than
   * existing superpixel segmentation methods. When tested on the Berkeley Segmentation Dataset, the average processing speed is 175 frames/s
   * with a Boundary Recall of 0.797 and an Achievable Segmentation Accuracy of 0.944. The computational complexity is quadratic O(n2) and
   * more suited to smaller images, but can still process a 2MP colour image faster than the SEEDS algorithm in OpenCV. The output is deterministic
   * when the number of processing threads is fixed, and requires the source image to be in Lab colour format.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ximgproc/include/opencv2/ximgproc/scansegment.hpp#L23
   */
  ximgproc_ScanSegment: MainModule['ximgproc_ScanSegment'] & StaticMembers<MainModule['Algorithm']>
/**
   * Class implementing the SEEDS (Superpixels Extracted via Energy-Driven Sampling) superpixels
   * algorithm described in [VBRV14] .
   *
   * The algorithm uses an efficient hill-climbing algorithm to optimize the superpixels' energy
   * function that is based on color histograms and a boundary term, which is optional. The energy
   * function encourages superpixels to be of the same color, and if the boundary term is activated, the
   * superpixels have smooth boundaries and are of similar shape. In practice it starts from a regular
   * grid of superpixels and moves the pixels or blocks of pixels at the boundaries to refine the
   * solution. The algorithm runs in real-time using a single CPU.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ximgproc/include/opencv2/ximgproc/seeds.hpp#L66
   */
  ximgproc_SuperpixelSEEDS: MainModule['ximgproc_SuperpixelSEEDS'] & StaticMembers<MainModule['Algorithm']>
/**
   * Graph Based Segmentation Algorithm.
   *                         The class implements the algorithm described in [PFF2004] .
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ximgproc/include/opencv2/ximgproc/segmentation.hpp#L46
   */
  ximgproc_segmentation_GraphSegmentation: MainModule['ximgproc_segmentation_GraphSegmentation'] & StaticMembers<MainModule['Algorithm']>
/**
   * Strategie for the selective search segmentation algorithm
   *                         The class implements a generic stragery for the algorithm described in [uijlings2013selective].
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ximgproc/include/opencv2/ximgproc/segmentation.hpp#L74
   */
  ximgproc_segmentation_SelectiveSearchSegmentationStrategy: MainModule['ximgproc_segmentation_SelectiveSearchSegmentationStrategy'] & StaticMembers<MainModule['Algorithm']>
/**
   * Color-based strategy for the selective search segmentation algorithm
   *                         The class is implemented from the algorithm described in [uijlings2013selective].
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ximgproc/include/opencv2/ximgproc/segmentation.hpp#L100
   */
  ximgproc_segmentation_SelectiveSearchSegmentationStrategyColor: MainModule['ximgproc_segmentation_SelectiveSearchSegmentationStrategyColor'] & StaticMembers<MainModule['ximgproc_segmentation_SelectiveSearchSegmentationStrategy']> & StaticMembers<MainModule['Algorithm']>
/**
   * Size-based strategy for the selective search segmentation algorithm
   *                         The class is implemented from the algorithm described in [uijlings2013selective].
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ximgproc/include/opencv2/ximgproc/segmentation.hpp#L109
   */
  ximgproc_segmentation_SelectiveSearchSegmentationStrategySize: MainModule['ximgproc_segmentation_SelectiveSearchSegmentationStrategySize'] & StaticMembers<MainModule['ximgproc_segmentation_SelectiveSearchSegmentationStrategy']> & StaticMembers<MainModule['Algorithm']>
/**
   * Texture-based strategy for the selective search segmentation algorithm
   *                         The class is implemented from the algorithm described in [uijlings2013selective].
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ximgproc/include/opencv2/ximgproc/segmentation.hpp#L118
   */
  ximgproc_segmentation_SelectiveSearchSegmentationStrategyTexture: MainModule['ximgproc_segmentation_SelectiveSearchSegmentationStrategyTexture'] & StaticMembers<MainModule['ximgproc_segmentation_SelectiveSearchSegmentationStrategy']> & StaticMembers<MainModule['Algorithm']>
/**
   * Fill-based strategy for the selective search segmentation algorithm
   *                         The class is implemented from the algorithm described in [uijlings2013selective].
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ximgproc/include/opencv2/ximgproc/segmentation.hpp#L127
   */
  ximgproc_segmentation_SelectiveSearchSegmentationStrategyFill: MainModule['ximgproc_segmentation_SelectiveSearchSegmentationStrategyFill'] & StaticMembers<MainModule['ximgproc_segmentation_SelectiveSearchSegmentationStrategy']> & StaticMembers<MainModule['Algorithm']>
/**
   * Regroup multiple strategies for the selective search segmentation algorithm
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ximgproc/include/opencv2/ximgproc/segmentation.hpp#L135
   */
  ximgproc_segmentation_SelectiveSearchSegmentationStrategyMultiple: MainModule['ximgproc_segmentation_SelectiveSearchSegmentationStrategyMultiple'] & StaticMembers<MainModule['ximgproc_segmentation_SelectiveSearchSegmentationStrategy']> & StaticMembers<MainModule['Algorithm']>
/**
   * Selective search segmentation algorithm
   *                         The class implements the algorithm described in [uijlings2013selective].
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ximgproc/include/opencv2/ximgproc/segmentation.hpp#L181
   */
  ximgproc_segmentation_SelectiveSearchSegmentation: MainModule['ximgproc_segmentation_SelectiveSearchSegmentation'] & StaticMembers<MainModule['Algorithm']>
/**
   * Class implementing the SLIC (Simple Linear Iterative Clustering) superpixels
   * algorithm described in [Achanta2012].
   *
   * SLIC (Simple Linear Iterative Clustering) clusters pixels using pixel channels and image plane space
   * to efficiently generate compact, nearly uniform superpixels. The simplicity of approach makes it
   * extremely easy to use a lone parameter specifies the number of superpixels and the efficiency of
   * the algorithm makes it very practical.
   * Several optimizations are available for SLIC class:
   * SLICO stands for "Zero parameter SLIC" and it is an optimization of baseline SLIC described in [Achanta2012].
   * MSLIC stands for "Manifold SLIC" and it is an optimization of baseline SLIC described in [Liu_2017_IEEE].
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ximgproc/include/opencv2/ximgproc/slic.hpp#L78
   */
  ximgproc_SuperpixelSLIC: MainModule['ximgproc_SuperpixelSLIC'] & StaticMembers<MainModule['Algorithm']>
/**
   * Main interface for all filters, that take sparse matches as an
   * input and produce a dense per-pixel matching (optical flow) as an output.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ximgproc/include/opencv2/ximgproc/sparse_match_interpolator.hpp#L52
   */
  ximgproc_SparseMatchInterpolator: MainModule['ximgproc_SparseMatchInterpolator'] & StaticMembers<MainModule['Algorithm']>
/**
   * Sparse match interpolation algorithm based on modified locally-weighted affine
   * estimator from [Revaud2015] and Fast Global Smoother as post-processing filter.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ximgproc/include/opencv2/ximgproc/sparse_match_interpolator.hpp#L77
   */
  ximgproc_EdgeAwareInterpolator: MainModule['ximgproc_EdgeAwareInterpolator'] & StaticMembers<MainModule['ximgproc_SparseMatchInterpolator']> & StaticMembers<MainModule['Algorithm']>
/**
   * Sparse match interpolation algorithm based on modified piecewise locally-weighted affine
   * estimator called Robust Interpolation method of Correspondences or RIC from [Hu2017] and Variational
   * and Fast Global Smoother as post-processing filter. The RICInterpolator is a extension of the EdgeAwareInterpolator.
   * Main concept of this extension is an piece-wise affine model based on over-segmentation via SLIC superpixel estimation.
   * The method contains an efficient propagation mechanism to estimate among the pieces-wise models.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ximgproc/include/opencv2/ximgproc/sparse_match_interpolator.hpp#L146
   */
  ximgproc_RICInterpolator: MainModule['ximgproc_RICInterpolator'] & StaticMembers<MainModule['ximgproc_SparseMatchInterpolator']> & StaticMembers<MainModule['Algorithm']>
/**
   * Helper class for training part of [P. Dollar and C. L. Zitnick. Structured Forests for Fast Edge Detection, 2013].
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ximgproc/include/opencv2/ximgproc/structured_edge_detection.hpp#L65
   */
  ximgproc_RFFeatureGetter: MainModule['ximgproc_RFFeatureGetter'] & StaticMembers<MainModule['Algorithm']>
/**
   * Class implementing edge detection algorithm from [Dollar2013] :
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ximgproc/include/opencv2/ximgproc/structured_edge_detection.hpp#L97
   */
  ximgproc_StructuredEdgeDetection: MainModule['ximgproc_StructuredEdgeDetection'] & StaticMembers<MainModule['Algorithm']>
/**
   * base cascade classifier value in the OpenCV API.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xobjdetect/include/opencv2/xobjdetect.hpp#L179
   */
  BaseCascadeClassifier: MainModule['BaseCascadeClassifier'] & StaticMembers<MainModule['Algorithm']>
/**
   * Synthetic frame sequence generator for testing background subtraction algorithms.
   *
   *  It will generate the moving object on top of the background.
   *  It will apply some distortion to the background to make the test more complex.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/bgsegm/include/opencv2/bgsegm.hpp#L402
   */
  bgsegm_SyntheticSequenceGenerator: MainModule['bgsegm_SyntheticSequenceGenerator'] & StaticMembers<MainModule['Algorithm']>
/**
   * Abstract base class for all face recognition models
   *
   * All face recognition models in OpenCV are derived from the abstract base class FaceRecognizer, which
   * provides a unified access to all face recongition algorithms in OpenCV.
   *
   * ### Description
   *
   * I'll go a bit more into detail explaining FaceRecognizer, because it doesn't look like a powerful
   * interface at first sight. But: Every FaceRecognizer is an Algorithm, so you can easily get/set all
   * model internals (if allowed by the implementation). Algorithm is a relatively new OpenCV concept,
   * which is available since the 2.4 release. I suggest you take a look at its description.
   *
   * Algorithm provides the following features for all derived classes:
   *
   * -   So called "virtual constructor". That is, each Algorithm derivative is registered at program
   *     start and you can get the list of registered algorithms and create instance of a particular
   *     algorithm by its name (see Algorithm::create). If you plan to add your own algorithms, it is
   *     good practice to add a unique prefix to your algorithms to distinguish them from other
   *     algorithms.
   * -   Setting/Retrieving algorithm parameters by name. If you used video capturing functionality from
   *     OpenCV highgui module, you are probably familar with cv::cvSetCaptureProperty,
   * ocvcvGetCaptureProperty, VideoCapture::set and VideoCapture::get. Algorithm provides similar
   *     method where instead of integer id's you specify the parameter names as text Strings. See
   *     Algorithm::set and Algorithm::get for details.
   * -   Reading and writing parameters from/to XML or YAML files. Every Algorithm derivative can store
   *     all its parameters and then read them back. There is no need to re-implement it each time.
   *
   * Moreover every FaceRecognizer supports the:
   *
   * -   **Training** of a FaceRecognizer with FaceRecognizer::train on a given set of images (your face
   *     database!).
   * -   **Prediction** of a given sample image, that means a face. The image is given as a Mat.
   * -   **Loading/Saving** the model state from/to a given XML or YAML.
   * -   **Setting/Getting labels info**, that is stored as a string. String labels info is useful for
   *     keeping names of the recognized people.
   *
   * **Note:** When using the FaceRecognizer interface in combination with Python, please stick to Python 2.
   * Some underlying scripts like create_csv will not work in other versions, like Python 3. Setting the
   * Thresholds +++++++++++++++++++++++
   *
   * Sometimes you run into the situation, when you want to apply a threshold on the prediction. A common
   * scenario in face recognition is to tell, whether a face belongs to the training dataset or if it is
   * unknown. You might wonder, why there's no public API in FaceRecognizer to set the threshold for the
   * prediction, but rest assured: It's supported. It just means there's no generic way in an abstract
   * class to provide an interface for setting/getting the thresholds of *every possible* FaceRecognizer
   * algorithm. The appropriate place to set the thresholds is in the constructor of the specific
   * FaceRecognizer and since every FaceRecognizer is a Algorithm (see above), you can get/set the
   * thresholds at runtime!
   *
   * Here is an example of setting a threshold for the Eigenfaces method, when creating the model:
   *
   * ```cpp
   * // Let's say we want to keep 10 Eigenfaces and have a threshold value of 10.0
   * int num_components = 10;
   * double threshold = 10.0;
   * // Then if you want to have a cv::FaceRecognizer with a confidence threshold,
   * // create the concrete implementation with the appropriate parameters:
   * Ptr<FaceRecognizer> model = EigenFaceRecognizer::create(num_components, threshold);
   *
   * ```
   *
   * Sometimes it's impossible to train the model, just to experiment with threshold values. Thanks to
   * Algorithm it's possible to set internal model thresholds during runtime. Let's see how we would
   * set/get the prediction for the Eigenface model, we've created above:
   *
   * ```cpp
   * // The following line reads the threshold from the Eigenfaces model:
   * double current_threshold = model->getDouble("threshold");
   * // And this line sets the threshold to 0.0:
   * model->set("threshold", 0.0);
   *
   * ```
   *
   * If you've set the threshold to 0.0 as we did above, then:
   *
   * ```cpp
   * //
   * Mat img = imread("person1/3.jpg", IMREAD_GRAYSCALE);
   * // Get a prediction from the model. Note: We've set a threshold of 0.0 above,
   * // since the distance is almost always larger than 0.0, you'll get -1 as
   * // label, which indicates, this face is unknown
   * int predicted_label = model->predict(img);
   * // ...
   *
   * ```
   *
   * is going to yield -1 as predicted label, which states this face is unknown.
   *
   * ### Getting the name of a FaceRecognizer
   *
   * Since every FaceRecognizer is a Algorithm, you can use Algorithm::name to get the name of a
   * FaceRecognizer:
   *
   * ```cpp
   * // Create a FaceRecognizer:
   * Ptr<FaceRecognizer> model = EigenFaceRecognizer::create();
   * // And here's how to get its name:
   * String name = model->name();
   *
   * ```
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/face/include/opencv2/face.hpp#L157
   */
  face_FaceRecognizer: MainModule['face_FaceRecognizer'] & StaticMembers<MainModule['Algorithm']>
/**
   * Implementation of bio-inspired features (BIF) from the paper:
   *  Guo, Guodong, et al. "Human age estimation using bio-inspired features."
   *  Computer Vision and Pattern Recognition, 2009. CVPR 2009.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/face/include/opencv2/face/bif.hpp#L57
   */
  face_BIF: MainModule['face_BIF'] & StaticMembers<MainModule['Algorithm']>
/**
   * face facemark kazemi value in the OpenCV API.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/face/include/opencv2/face/face_alignment.hpp#L11
   */
  face_FacemarkKazemi: MainModule['face_FacemarkKazemi'] & StaticMembers<MainModule['face_Facemark']> & StaticMembers<MainModule['Algorithm']>
/**
   * Abstract base class for all facemark models
   *
   * To utilize this API in your program, please take a look at the `tutorial_table_of_content_facemark`
   * ### Description
   *
   * Facemark is a base class which provides universal access to any specific facemark algorithm.
   * Therefore, the users should declare a desired algorithm before they can use it in their application.
   *
   * Here is an example on how to declare a facemark algorithm:
   *
   * ```cpp
   * // Using Facemark in your code:
   * Ptr<Facemark> facemark = createFacemarkLBF();
   *
   * ```
   *
   * The typical pipeline for facemark detection is as follows:
   * - Load the trained model using Facemark::loadModel.
   * - Perform the fitting on an image via Facemark::fit.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/face/include/opencv2/face/facemark.hpp#L43
   */
  face_Facemark: MainModule['face_Facemark'] & StaticMembers<MainModule['Algorithm']>
/**
   * face facemark aam value in the OpenCV API.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/face/include/opencv2/face/facemarkAAM.hpp#L47
   */
  face_FacemarkAAM: MainModule['face_FacemarkAAM'] & StaticMembers<MainModule['face_FacemarkTrain']> & StaticMembers<MainModule['face_Facemark']> & StaticMembers<MainModule['Algorithm']>
/**
   * face facemark lbf value in the OpenCV API.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/face/include/opencv2/face/facemarkLBF.hpp#L48
   */
  face_FacemarkLBF: MainModule['face_FacemarkLBF'] & StaticMembers<MainModule['face_FacemarkTrain']> & StaticMembers<MainModule['face_Facemark']> & StaticMembers<MainModule['Algorithm']>
/**
   * Abstract base class for trainable facemark models
   *
   * To utilize this API in your program, please take a look at the `tutorial_table_of_content_facemark`
   * ### Description
   *
   * The AAM and LBF facemark models in OpenCV are derived from the abstract base class FacemarkTrain, which
   * provides a unified access to those facemark algorithms in OpenCV.
   *
   * Here is an example on how to declare facemark algorithm:
   *
   * ```cpp
   * // Using Facemark in your code:
   * Ptr<Facemark> facemark = FacemarkLBF::create();
   *
   * ```
   *
   * The typical pipeline for facemark detection is listed as follows:
   * - (Non-mandatory) Set a user defined face detection using FacemarkTrain::setFaceDetector.
   *   The facemark algorithms are designed to fit the facial points into a face.
   *   Therefore, the face information should be provided to the facemark algorithm.
   *   Some algorithms might provides a default face recognition function.
   *   However, the users might prefer to use their own face detector to obtains the best possible detection result.
   * - (Non-mandatory) Training the model for a specific algorithm using FacemarkTrain::training.
   *   In this case, the model should be automatically saved by the algorithm.
   *   If the user already have a trained model, then this part can be omitted.
   * - Load the trained model using Facemark::loadModel.
   * - Perform the fitting via the Facemark::fit.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/face/include/opencv2/face/facemark_train.hpp#L256
   */
  face_FacemarkTrain: MainModule['face_FacemarkTrain'] & StaticMembers<MainModule['face_Facemark']> & StaticMembers<MainModule['Algorithm']>
/**
   * base for two classes
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/face/include/opencv2/face/facerec.hpp#L20
   */
  face_BasicFaceRecognizer: MainModule['face_BasicFaceRecognizer'] & StaticMembers<MainModule['face_FaceRecognizer']> & StaticMembers<MainModule['Algorithm']>
/**
   * face eigen face recognizer value in the OpenCV API.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/face/include/opencv2/face/facerec.hpp#L54
   */
  face_EigenFaceRecognizer: MainModule['face_EigenFaceRecognizer'] & StaticMembers<MainModule['face_BasicFaceRecognizer']> & StaticMembers<MainModule['face_FaceRecognizer']> & StaticMembers<MainModule['Algorithm']>
/**
   * face fisher face recognizer value in the OpenCV API.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/face/include/opencv2/face/facerec.hpp#L89
   */
  face_FisherFaceRecognizer: MainModule['face_FisherFaceRecognizer'] & StaticMembers<MainModule['face_BasicFaceRecognizer']> & StaticMembers<MainModule['face_FaceRecognizer']> & StaticMembers<MainModule['Algorithm']>
/**
   * face lbphface recognizer value in the OpenCV API.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/face/include/opencv2/face/facerec.hpp#L126
   */
  face_LBPHFaceRecognizer: MainModule['face_LBPHFaceRecognizer'] & StaticMembers<MainModule['face_FaceRecognizer']> & StaticMembers<MainModule['Algorithm']>
/**
   * Minimum Average Correlation Energy Filter
   *     useful for authentication with (cancellable) biometrical features.
   *     (does not need many positives to train (10-50), and no negatives at all, also robust to noise/salting)
   *
   *     see also: [Savvides04]
   *
   *     this implementation is largely based on: https://code.google.com/archive/p/pam-face-authentication (GSOC 2009)
   *
   *     use it like:
   *     
   * ```cpp
   *
   *     Ptr<face::MACE> mace = face::MACE::create(64);
   *
   *     vector<Mat> pos_images = ...
   *     mace->train(pos_images);
   *
   *     Mat query = ...
   *     bool same = mace->same(query);
   *
   * ```
   *
   *     you can also use two-factor authentication, with an additional passphrase:
   *
   * ```cpp
   *     String owners_passphrase = "ilikehotdogs";
   *     Ptr<face::MACE> mace = face::MACE::create(64);
   *     mace->salt(owners_passphrase);
   *     vector<Mat> pos_images = ...
   *     mace->train(pos_images);
   *
   *     // now, users have to give a valid passphrase, along with the image:
   *     Mat query = ...
   *     cout << "enter passphrase: ";
   *     string pass;
   *     getline(cin, pass);
   *     mace->salt(pass);
   *     bool same = mace->same(query);
   *     
   * ```
   *
   *     save/load your model:
   *     
   * ```cpp
   *     Ptr<face::MACE> mace = face::MACE::create(64);
   *     mace->train(pos_images);
   *     mace->save("my_mace.xml");
   *
   *     // later:
   *     Ptr<MACE> reloaded = MACE::load("my_mace.xml");
   *     reloaded->same(some_image);
   *     
   * ```
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/face/include/opencv2/face/mace.hpp#L71
   */
  face_MACE: MainModule['face_MACE'] & StaticMembers<MainModule['Algorithm']>
/**
   * Default predict collector
   *
   * Trace minimal distance with treshhold checking (that is default behavior for most predict logic)
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/face/include/opencv2/face/predict_collector.hpp#L82
   */
  face_StandardCollector: MainModule['face_StandardCollector'] & StaticMembers<MainModule['face_PredictCollector']>
/**
   * Class for individual tree.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/optflow/include/opencv2/optflow/sparse_matching_gpc.hpp#L154
   */
  optflow_GPCTree: MainModule['optflow_GPCTree'] & StaticMembers<MainModule['Algorithm']>
/**
   * SFMLibmvEuclideanReconstruction class provides an interface with the Libmv Structure From Motion pipeline.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/sfm/include/opencv2/sfm/simple_pipeline.hpp#L195
   */
  sfm_SFMLibmvEuclideanReconstruction: MainModule['sfm_SFMLibmvEuclideanReconstruction'] & StaticMembers<MainModule['sfm_BaseSFM']>
/**
   * Simple blender which mixes images at its borders.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/stitching/include/opencv2/stitching/detail/blenders.hpp#L100
   */
  detail_FeatherBlender: MainModule['detail_FeatherBlender'] & StaticMembers<MainModule['detail_Blender']>
/**
   * Blender which uses multi-band blending algorithm (see [BA83]).
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/stitching/include/opencv2/stitching/detail/blenders.hpp#L127
   */
  detail_MultiBandBlender: MainModule['detail_MultiBandBlender'] & StaticMembers<MainModule['detail_Blender']>
/**
   * Stub exposure compensator which does nothing.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/stitching/include/opencv2/stitching/detail/exposure_compensate.hpp#L99
   */
  detail_NoExposureCompensator: MainModule['detail_NoExposureCompensator'] & StaticMembers<MainModule['detail_ExposureCompensator']>
/**
   * Exposure compensator which tries to remove exposure related artifacts by adjusting image
   * intensities, see [BL07] and [WJ10] for details.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/stitching/include/opencv2/stitching/detail/exposure_compensate.hpp#L112
   */
  detail_GainCompensator: MainModule['detail_GainCompensator'] & StaticMembers<MainModule['detail_ExposureCompensator']>
/**
   * Exposure compensator which tries to remove exposure related artifacts by adjusting image
   * intensities on each channel independently.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/stitching/include/opencv2/stitching/detail/exposure_compensate.hpp#L146
   */
  detail_ChannelsCompensator: MainModule['detail_ChannelsCompensator'] & StaticMembers<MainModule['detail_ExposureCompensator']>
/**
   * Exposure compensator which tries to remove exposure related artifacts by adjusting image blocks.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/stitching/include/opencv2/stitching/detail/exposure_compensate.hpp#L170
   */
  detail_BlocksCompensator: MainModule['detail_BlocksCompensator'] & StaticMembers<MainModule['detail_ExposureCompensator']>
/**
   * Exposure compensator which tries to remove exposure related artifacts by adjusting image block
   * intensities, see [UES01] for details.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/stitching/include/opencv2/stitching/detail/exposure_compensate.hpp#L208
   */
  detail_BlocksGainCompensator: MainModule['detail_BlocksGainCompensator'] & StaticMembers<MainModule['detail_BlocksCompensator']> & StaticMembers<MainModule['detail_ExposureCompensator']>
/**
   * Exposure compensator which tries to remove exposure related artifacts by adjusting image block
   * on each channel.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/stitching/include/opencv2/stitching/detail/exposure_compensate.hpp#L232
   */
  detail_BlocksChannelsCompensator: MainModule['detail_BlocksChannelsCompensator'] & StaticMembers<MainModule['detail_BlocksCompensator']> & StaticMembers<MainModule['detail_ExposureCompensator']>
/**
   * Features matcher which finds two best matches for each feature and leaves the best one only if the
   * ratio between descriptor distances is greater than the threshold match_conf
   *
   * See: detail::FeaturesMatcher
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/stitching/include/opencv2/stitching/detail/matchers.hpp#L182
   */
  detail_BestOf2NearestMatcher: MainModule['detail_BestOf2NearestMatcher'] & StaticMembers<MainModule['detail_FeaturesMatcher']>
/**
   * detail best of2 nearest range matcher value in the OpenCV API.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/stitching/include/opencv2/stitching/detail/matchers.hpp#L212
   */
  detail_BestOf2NearestRangeMatcher: MainModule['detail_BestOf2NearestRangeMatcher'] & StaticMembers<MainModule['detail_BestOf2NearestMatcher']> & StaticMembers<MainModule['detail_FeaturesMatcher']>
/**
   * Features matcher similar to cv::detail::BestOf2NearestMatcher which
   * finds two best matches for each feature and leaves the best one only if the
   * ratio between descriptor distances is greater than the threshold match_conf.
   *
   * Unlike cv::detail::BestOf2NearestMatcher this matcher uses affine
   * transformation (affine transformation estimate will be placed in matches_info).
   *
   * See: cv::detail::FeaturesMatcher cv::detail::BestOf2NearestMatcher
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/stitching/include/opencv2/stitching/detail/matchers.hpp#L236
   */
  detail_AffineBestOf2NearestMatcher: MainModule['detail_AffineBestOf2NearestMatcher'] & StaticMembers<MainModule['detail_BestOf2NearestMatcher']> & StaticMembers<MainModule['detail_FeaturesMatcher']>
/**
   * Features matcher that adapts LightGlueMatcher (DescriptorMatcher) to the
   * stitching pipeline's FeaturesMatcher interface.
   *
   * This matcher uses DNN-based LightGlue for feature matching, requiring ALIKED-style
   * keypoints with spatial context for positional encoding.
   *
   * See: cv::detail::FeaturesMatcher cv::LightGlueMatcher
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/stitching/include/opencv2/stitching/detail/matchers.hpp#L270
   */
  detail_LightGlueFeaturesMatcher: MainModule['detail_LightGlueFeaturesMatcher'] & StaticMembers<MainModule['detail_FeaturesMatcher']>
/**
   * Homography based rotation estimator.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/stitching/include/opencv2/stitching/detail/motion_estimators.hpp#L100
   */
  detail_HomographyBasedEstimator: MainModule['detail_HomographyBasedEstimator'] & StaticMembers<MainModule['detail_Estimator']>
/**
   * Affine transformation based estimator.
   *
   * This estimator uses pairwise transformations estimated by matcher to estimate
   * final transformation for each camera.
   *
   * See: cv::detail::HomographyBasedEstimator
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/stitching/include/opencv2/stitching/detail/motion_estimators.hpp#L121
   */
  detail_AffineBasedEstimator: MainModule['detail_AffineBasedEstimator'] & StaticMembers<MainModule['detail_Estimator']>
/**
   * Base class for all camera parameters refinement methods.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/stitching/include/opencv2/stitching/detail/motion_estimators.hpp#L133
   */
  detail_BundleAdjusterBase: MainModule['detail_BundleAdjusterBase'] & StaticMembers<MainModule['detail_Estimator']>
/**
   * Stub bundle adjuster that does nothing.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/stitching/include/opencv2/stitching/detail/motion_estimators.hpp#L221
   */
  detail_NoBundleAdjuster: MainModule['detail_NoBundleAdjuster'] & StaticMembers<MainModule['detail_BundleAdjusterBase']> & StaticMembers<MainModule['detail_Estimator']>
/**
   * Implementation of the camera parameters refinement algorithm which minimizes sum of the reprojection
   * error squares
   *
   * It can estimate focal length, aspect ratio, principal point.
   * You can affect only on them via the refinement mask.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/stitching/include/opencv2/stitching/detail/motion_estimators.hpp#L245
   */
  detail_BundleAdjusterReproj: MainModule['detail_BundleAdjusterReproj'] & StaticMembers<MainModule['detail_BundleAdjusterBase']> & StaticMembers<MainModule['detail_Estimator']>
/**
   * Implementation of the camera parameters refinement algorithm which minimizes sum of the distances
   * between the rays passing through the camera center and a feature. :
   *
   * It can estimate focal length. It ignores the refinement mask for now.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/stitching/include/opencv2/stitching/detail/motion_estimators.hpp#L265
   */
  detail_BundleAdjusterRay: MainModule['detail_BundleAdjusterRay'] & StaticMembers<MainModule['detail_BundleAdjusterBase']> & StaticMembers<MainModule['detail_Estimator']>
/**
   * Bundle adjuster that expects affine transformation
   * represented in homogeneous coordinates in R for each camera param. Implements
   * camera parameters refinement algorithm which minimizes sum of the reprojection
   * error squares
   *
   * It estimates all transformation parameters. Refinement mask is ignored.
   *
   * See: AffineBasedEstimator AffineBestOf2NearestMatcher BundleAdjusterAffinePartial
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/stitching/include/opencv2/stitching/detail/motion_estimators.hpp#L289
   */
  detail_BundleAdjusterAffine: MainModule['detail_BundleAdjusterAffine'] & StaticMembers<MainModule['detail_BundleAdjusterBase']> & StaticMembers<MainModule['detail_Estimator']>
/**
   * Bundle adjuster that expects affine transformation with 4 DOF
   * represented in homogeneous coordinates in R for each camera param. Implements
   * camera parameters refinement algorithm which minimizes sum of the reprojection
   * error squares
   *
   * It estimates all transformation parameters. Refinement mask is ignored.
   *
   * See: AffineBasedEstimator AffineBestOf2NearestMatcher BundleAdjusterAffine
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/stitching/include/opencv2/stitching/detail/motion_estimators.hpp#L313
   */
  detail_BundleAdjusterAffinePartial: MainModule['detail_BundleAdjusterAffinePartial'] & StaticMembers<MainModule['detail_BundleAdjusterBase']> & StaticMembers<MainModule['detail_Estimator']>
/**
   * Stub seam estimator which does nothing.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/stitching/include/opencv2/stitching/detail/seam_finders.hpp#L76
   */
  detail_NoSeamFinder: MainModule['detail_NoSeamFinder'] & StaticMembers<MainModule['detail_SeamFinder']>
/**
   * Base class for all pairwise seam estimators.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/stitching/include/opencv2/stitching/detail/seam_finders.hpp#L84
   */
  detail_PairwiseSeamFinder: MainModule['detail_PairwiseSeamFinder'] & StaticMembers<MainModule['detail_SeamFinder']>
/**
   * Voronoi diagram-based seam estimator.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/stitching/include/opencv2/stitching/detail/seam_finders.hpp#L108
   */
  detail_VoronoiSeamFinder: MainModule['detail_VoronoiSeamFinder'] & StaticMembers<MainModule['detail_PairwiseSeamFinder']> & StaticMembers<MainModule['detail_SeamFinder']>
/**
   * detail dp seam finder value in the OpenCV API.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/stitching/include/opencv2/stitching/detail/seam_finders.hpp#L120
   */
  detail_DpSeamFinder: MainModule['detail_DpSeamFinder'] & StaticMembers<MainModule['detail_SeamFinder']>
/**
   * detail timelapser crop value in the OpenCV API.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/stitching/include/opencv2/stitching/detail/timelapsers.hpp#L80
   */
  detail_TimelapserCrop: MainModule['detail_TimelapserCrop'] & StaticMembers<MainModule['detail_Timelapser']>
/**
   * Extracts rotation and translation matrices from matrix H representing
   *         affine transformation in homogeneous coordinates
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/stitching/include/opencv2/stitching/detail/warpers.hpp#L294
   */
  detail_SphericalProjector: MainModule['detail_SphericalProjector'] & StaticMembers<MainModule['detail_ProjectorBase']>
/**
   * Class implementing the Gray-code pattern, based on [UNDERWORLD].
   *
   *  The generation of the pattern images is performed with Gray encoding using the traditional white and black colors.
   *
   *  The information about the two image axes x, y is encoded separately into two different pattern sequences.
   *  A projector P with resolution (P_res_x, P_res_y) will result in Ncols = log 2 (P_res_x) encoded pattern images representing the columns, and
   *  in Nrows = log 2 (P_res_y) encoded pattern images representing the rows.
   *  For example a projector with resolution 1024x768 will result in Ncols = 10 and Nrows = 10.
   *  However, the generated pattern sequence consists of both regular color and color-inverted images: inverted pattern images are images
   *  with the same structure as the original but with inverted colors.
   *  This provides an effective method for easily determining the intensity value of each pixel when it is lit (highest value) and
   *  when it is not lit (lowest value). So for a a projector with resolution 1024x768, the number of pattern images will be Ncols * 2 + Nrows * 2 = 40.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/structured_light/include/opencv2/structured_light/graycodepattern.hpp#L68
   */
  structured_light_GrayCodePattern: MainModule['structured_light_GrayCodePattern'] & StaticMembers<MainModule['structured_light_StructuredLightPattern']> & StaticMembers<MainModule['Algorithm']>
/**
   * Class implementing Fourier transform profilometry (FTP) , phase-shifting profilometry (PSP)
   * and Fourier-assisted phase-shifting profilometry (FAPS) based on [faps].
   * This class generates sinusoidal patterns that can be used with FTP, PSP and FAPS.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/structured_light/include/opencv2/structured_light/sinusoidalpattern.hpp#L68
   */
  structured_light_SinusoidalPattern: MainModule['structured_light_SinusoidalPattern'] & StaticMembers<MainModule['structured_light_StructuredLightPattern']> & StaticMembers<MainModule['Algorithm']> & {
/**
   * Parameters of SinusoidalPattern constructor
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/structured_light/include/opencv2/structured_light/sinusoidalpattern.hpp#L82
   */
 Params: MainModule['structured_light_SinusoidalPattern_Params']
 }
/**
   * Abstract base class for generating and decoding structured light patterns.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/structured_light/include/opencv2/structured_light/structured_light.hpp#L61
   */
  structured_light_StructuredLightPattern: MainModule['structured_light_StructuredLightPattern'] & StaticMembers<MainModule['Algorithm']>
/**
   * Tracking is an important issue for many computer vision applications in real world scenario.
   * The development in this area is very fragmented and this API is an interface useful for plug several algorithms and compare them.
   * the CSRT tracker
   *
   * The implementation is based on [Lukezic_IJCV2018] Discriminative Correlation Filter with Channel and Spatial Reliability
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/tracking/include/opencv2/tracking.hpp#L34
   */
  TrackerCSRT: MainModule['TrackerCSRT'] & StaticMembers<MainModule['Tracker']> & {
/**
   * tracker csrt params value in the OpenCV API.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/tracking/include/opencv2/tracking.hpp#L41
   */
 Params: MainModule['TrackerCSRT_Params']
 }
/**
   * the KCF (Kernelized Correlation Filter) tracker
   * KCF is a novel tracking framework that utilizes properties of circulant matrix to enhance the processing speed.
   * This tracking method is an implementation of [KCF_ECCV] which is extended to KCF with color-names features ([KCF_CN]).
   * The original paper of KCF is available at <http://www.robots.ox.ac.uk/~joao/publications/henriques_tpami2015.pdf>
   * as well as the matlab implementation. For more information about KCF with color-names features, please refer to
   * <http://www.cvl.isy.liu.se/research/objrec/visualtracking/colvistrack/index.html>.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/tracking/include/opencv2/tracking.hpp#L98
   */
  TrackerKCF: MainModule['TrackerKCF'] & StaticMembers<MainModule['Tracker']> & {
/**
   * tracker kcf params value in the OpenCV API.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/tracking/include/opencv2/tracking.hpp#L117
   */
 Params: MainModule['TrackerKCF_Params']
 }
/**
   * Tracker Base Class ***********************************
   * Base abstract class for the long-term tracker:
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/tracking/include/opencv2/tracking/tracking_legacy.hpp#L72
   */
  legacy_Tracker: MainModule['legacy_Tracker'] & StaticMembers<MainModule['Algorithm']>
/**
   * Specific Tracker Classes ***********************************
   * The MIL algorithm trains a classifier in an online manner to separate the object from the
   * background.
   *
   * Multiple Instance Learning avoids the drift problem for a robust tracking. The implementation is
   * based on [MIL] .
   *
   * Original code can be found here <http://vision.ucsd.edu/~bbabenko/project_miltrack.shtml>
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/tracking/include/opencv2/tracking/tracking_legacy.hpp#L123
   */
  legacy_TrackerMIL: MainModule['legacy_TrackerMIL'] & StaticMembers<MainModule['legacy_Tracker']> & StaticMembers<MainModule['Algorithm']>
/**
   * the Boosting tracker
   *
   * This is a real-time object tracking based on a novel on-line version of the AdaBoost algorithm.
   * The classifier uses the surrounding background as negative examples in update step to avoid the
   * drifting problem. The implementation is based on [OLB] .
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/tracking/include/opencv2/tracking/tracking_legacy.hpp#L148
   */
  legacy_TrackerBoosting: MainModule['legacy_TrackerBoosting'] & StaticMembers<MainModule['legacy_Tracker']> & StaticMembers<MainModule['Algorithm']>
/**
   * the Median Flow tracker
   *
   * Implementation of a paper [MedianFlow] .
   *
   * The tracker is suitable for very smooth and predictable movements when object is visible throughout
   * the whole sequence. It's quite and accurate for this type of problems (in particular, it was shown
   * by authors to outperform MIL). During the implementation period the code at
   * <http://www.aonsquared.co.uk/node/5>, the courtesy of the author Arthur Amarra, was used for the
   * reference purpose.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/tracking/include/opencv2/tracking/tracking_legacy.hpp#L190
   */
  legacy_TrackerMedianFlow: MainModule['legacy_TrackerMedianFlow'] & StaticMembers<MainModule['legacy_Tracker']> & StaticMembers<MainModule['Algorithm']>
/**
   * the TLD (Tracking, learning and detection) tracker
   *
   * TLD is a novel tracking framework that explicitly decomposes the long-term tracking task into
   * tracking, learning and detection.
   *
   * The tracker follows the object from frame to frame. The detector localizes all appearances that
   * have been observed so far and corrects the tracker if necessary. The learning estimates detector's
   * errors and updates it to avoid these errors in the future. The implementation is based on [TLD] .
   *
   * The Median Flow algorithm (see cv::TrackerMedianFlow) was chosen as a tracking component in this
   * implementation, following authors. The tracker is supposed to be able to handle rapid motions, partial
   * occlusions, object absence etc.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/tracking/include/opencv2/tracking/tracking_legacy.hpp#L232
   */
  legacy_TrackerTLD: MainModule['legacy_TrackerTLD'] & StaticMembers<MainModule['legacy_Tracker']> & StaticMembers<MainModule['Algorithm']>
/**
   * the KCF (Kernelized Correlation Filter) tracker
   * KCF is a novel tracking framework that utilizes properties of circulant matrix to enhance the processing speed.
   * This tracking method is an implementation of [KCF_ECCV] which is extended to KCF with color-names features ([KCF_CN]).
   * The original paper of KCF is available at <http://www.robots.ox.ac.uk/~joao/publications/henriques_tpami2015.pdf>
   * as well as the matlab implementation. For more information about KCF with color-names features, please refer to
   * <http://www.cvl.isy.liu.se/research/objrec/visualtracking/colvistrack/index.html>.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/tracking/include/opencv2/tracking/tracking_legacy.hpp#L260
   */
  legacy_TrackerKCF: MainModule['legacy_TrackerKCF'] & StaticMembers<MainModule['legacy_Tracker']> & StaticMembers<MainModule['Algorithm']>
/**
   * the MOSSE (Minimum Output Sum of Squared %Error) tracker
   *
   * The implementation is based on [MOSSE] Visual Object Tracking using Adaptive Correlation Filters
   *
   * **Note:** this tracker works with grayscale images, if passed bgr ones, they will get converted internally.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/tracking/include/opencv2/tracking/tracking_legacy.hpp#L295
   */
  legacy_TrackerMOSSE: MainModule['legacy_TrackerMOSSE'] & StaticMembers<MainModule['legacy_Tracker']> & StaticMembers<MainModule['Algorithm']>
/**
   * MultiTracker Class ---By Laksono Kurnianggoro---) ***********************************
   * This class is used to track multiple objects using the specified tracker algorithm.
   * The %MultiTracker is naive implementation of multiple object tracking.
   * It process the tracked objects independently without any optimization accross the tracked objects.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/tracking/include/opencv2/tracking/tracking_legacy.hpp#L312
   */
  legacy_MultiTracker: MainModule['legacy_MultiTracker'] & StaticMembers<MainModule['Algorithm']>
/**
   * CSRT ***********************************
   * the CSRT tracker
   *
   * The implementation is based on [Lukezic_IJCV2018] Discriminative Correlation Filter with Channel and Spatial Reliability
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/tracking/include/opencv2/tracking/tracking_legacy.hpp#L461
   */
  legacy_TrackerCSRT: MainModule['legacy_TrackerCSRT'] & StaticMembers<MainModule['legacy_Tracker']> & StaticMembers<MainModule['Algorithm']>
/**
   * class which allows the Gipsa/Listic Labs model to be used with OpenCV.
   *
   * This retina model allows spatio-temporal image processing (applied on still images, video sequences).
   * As a summary, these are the retina model properties:
   * - It applies a spectral whithening (mid-frequency details enhancement)
   * - high frequency spatio-temporal noise reduction
   * - low frequency luminance to be reduced (luminance range compression)
   * - local logarithmic luminance compression allows details to be enhanced in low light conditions
   *
   * USE : this model can be used basically for spatio-temporal video effects but also for :
   *      _using the getParvo method output matrix : texture analysiswith enhanced signal to noise ratio and enhanced details robust against input images luminance ranges
   *      _using the getMagno method output matrix : motion analysis also with the previously cited properties
   *
   * for more information, reer to the following papers :
   * Benoit A., Caplier A., Durette B., Herault, J., "USING HUMAN VISUAL SYSTEM MODELING FOR BIO-INSPIRED LOW LEVEL IMAGE PROCESSING", Elsevier, Computer Vision and Image Understanding 114 (2010), pp. 758-773, DOI: http://dx.doi.org/10.1016/j.cviu.2010.01.011
   * Vision: Images, Signals and Neural Networks: Models of Neural Processing in Visual Perception (Progress in Neural Processing),By: Jeanny Herault, ISBN: 9814273686. WAPI (Tower ID): 113266891.
   *
   * The retina filter includes the research contributions of phd/research collegues from which code has been redrawn by the author :
   * take a look at the retinacolor.hpp module to discover Brice Chaix de Lavarene color mosaicing/demosaicing and the reference paper:
   * B. Chaix de Lavarene, D. Alleysson, B. Durette, J. Herault (2007). "Efficient demosaicing through recursive filtering", IEEE International Conference on Image Processing ICIP 2007
   * take a look at imagelogpolprojection.hpp to discover retina spatial log sampling which originates from Barthelemy Durette phd with Jeanny Herault. A Retina / V1 cortex projection is also proposed and originates from Jeanny's discussions.
   * more informations in the above cited Jeanny Heraults's book.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/bioinspired/include/opencv2/bioinspired/retina.hpp#L162
   */
  bioinspired_Retina: MainModule['bioinspired_Retina'] & StaticMembers<MainModule['Algorithm']>
/**
   * a wrapper class which allows the tone mapping algorithm of Meylan&al(2007) to be used with OpenCV.
   *
   * This algorithm is already implemented in thre Retina class (retina::applyFastToneMapping) but used it does not require all the retina model to be allocated. This allows a light memory use for low memory devices (smartphones, etc.
   * As a summary, these are the model properties:
   * - 2 stages of local luminance adaptation with a different local neighborhood for each.
   * - first stage models the retina photorecetors local luminance adaptation
   * - second stage models th ganglion cells local information adaptation
   * - compared to the initial publication, this class uses spatio-temporal low pass filters instead of spatial only filters.
   *   this can help noise robustness and temporal stability for video sequence use cases.
   *
   * for more information, read to the following papers :
   * Meylan L., Alleysson D., and Susstrunk S., A Model of Retinal Local Adaptation for the Tone Mapping of Color Filter Array Images, Journal of Optical Society of America, A, Vol. 24, N 9, September, 1st, 2007, pp. 2807-2816Benoit A., Caplier A., Durette B., Herault, J., "USING HUMAN VISUAL SYSTEM MODELING FOR BIO-INSPIRED LOW LEVEL IMAGE PROCESSING", Elsevier, Computer Vision and Image Understanding 114 (2010), pp. 758-773, DOI: http://dx.doi.org/10.1016/j.cviu.2010.01.011
   * regarding spatio-temporal filter and the bigger retina model :
   * Vision: Images, Signals and Neural Networks: Models of Neural Processing in Visual Perception (Progress in Neural Processing),By: Jeanny Herault, ISBN: 9814273686. WAPI (Tower ID): 113266891.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/bioinspired/include/opencv2/bioinspired/retinafasttonemapping.hpp#L99
   */
  bioinspired_RetinaFastToneMapping: MainModule['bioinspired_RetinaFastToneMapping'] & StaticMembers<MainModule['Algorithm']>
/**
   * class which provides a transient/moving areas segmentation module
   *
   * perform a locally adapted segmentation by using the retina magno input data Based on Alexandre
   * BENOIT thesis: "Le système visuel humain au secours de la vision par ordinateur"
   *
   * 3 spatio temporal filters are used:
   * - a first one which filters the noise and local variations of the input motion energy
   * - a second (more powerfull low pass spatial filter) which gives the neighborhood motion energy the
   * segmentation consists in the comparison of these both outputs, if the local motion energy is higher
   * to the neighborhood otion energy, then the area is considered as moving and is segmented
   * - a stronger third low pass filter helps decision by providing a smooth information about the
   * "motion context" in a wider area
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/bioinspired/include/opencv2/bioinspired/transientareassegmentationmodule.hpp#L122
   */
  bioinspired_TransientAreasSegmentationModule: MainModule['bioinspired_TransientAreasSegmentationModule'] & StaticMembers<MainModule['Algorithm']>
/**
   * utils nested original class name value in the OpenCV API.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/bindings_utils.hpp#L281
   */
  utils_nested_OriginalClassName: MainModule['utils_nested_OriginalClassName'] & {
/**
   * utils nested original class name params value in the OpenCV API.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/bindings_utils.hpp#L284
   */
 Params: MainModule['utils_nested_OriginalClassName_Params']
 }
/**
   * QR code encoder.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/objdetect/include/opencv2/objdetect.hpp#L152
   */
  QRCodeEncoder: MainModule['QRCodeEncoder'] & {
/**
   * QR code encoder parameters.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/objdetect/include/opencv2/objdetect.hpp#L181
   */
 Params: MainModule['QRCodeEncoder_Params']
 }
/**
   * This is a C++ abstract class, it provides external user API to work with DPM.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/dpm/include/opencv2/dpm.hpp#L104
   */
  dpm_DPMDetector: MainModule['dpm_DPMDetector'] & {
/**
   * dpm dpmdetector object detection value in the OpenCV API.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/dpm/include/opencv2/dpm.hpp#L108
   */
 ObjectDetection: MainModule['dpm_DPMDetector_ObjectDetection']
 }
}

/** Native exports under a C++ namespace, with their exact signatures. */
export type CVNamespace<Prefix extends string> = {
  [Key in keyof AugmentedModule as Key extends `${Prefix}_${infer Name}` ? Name : never]: AugmentedModule[Key]
}

/** Nested namespace views generated from this build's declarations. */
export type NativeNamespaces = {
  /** Native alphamat namespace. */
  alphamat: CVNamespace<'alphamat'> & {

}
  /** Native aruco namespace. */
  aruco: CVNamespace<'aruco'> & {
/**
   * An owned native vector. Append values with push_back, read them with get, and release the vector with using or delete(). Native object elements returned by get require separate disposal.
   */
  _DictionaryVector: AugmentedModule['aruco__DictionaryVector']
/**
   * Board of ArUco markers
   *
   * A board is a set of markers in the 3D space with a common coordinate system.
   * The common form of a board of marker is a planar (2D) board, however any 3D layout can be used.
   * A Board object is composed by:
   * - The object points of the marker corners, i.e. their coordinates respect to the board system.
   * - The dictionary which indicates the type of markers of the board
   * - The identifier of all the markers in the board.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/objdetect/include/opencv2/objdetect/aruco_board.hpp#L25
   */
  Board: AugmentedModule['aruco_Board']
/**
   * Planar board with grid arrangement of markers
   *
   * More common type of board. All markers are placed in the same plane in a grid arrangement.
   * The board image can be drawn using generateImage() method.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/objdetect/include/opencv2/objdetect/aruco_board.hpp#L107
   */
  GridBoard: AugmentedModule['aruco_GridBoard']
/**
   * ChArUco board is a planar chessboard where the markers are placed inside the white squares of a chessboard.
   *
   * The benefits of ChArUco boards is that they provide both, ArUco markers versatility and chessboard corner precision,
   * which is important for calibration and pose estimation. The board image can be drawn using generateImage() method.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/objdetect/include/opencv2/objdetect/aruco_board.hpp#L135
   */
  CharucoBoard: AugmentedModule['aruco_CharucoBoard']
/**
   * struct DetectorParameters is used by ArucoDetector
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/objdetect/include/opencv2/objdetect/aruco_detector.hpp#L27
   */
  DetectorParameters: AugmentedModule['aruco_DetectorParameters']
/**
   * struct RefineParameters is used by ArucoDetector
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/objdetect/include/opencv2/objdetect/aruco_detector.hpp#L244
   */
  RefineParameters: AugmentedModule['aruco_RefineParameters']
/**
   * The main functionality of ArucoDetector class is detection of markers in an image with detectMarkers() method.
   *
   * After detecting some markers in the image, you can try to find undetected markers from this dictionary with
   * refineDetectedMarkers() method.
   *
   * See: DetectorParameters, RefineParameters
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/objdetect/include/opencv2/objdetect/aruco_detector.hpp#L281
   */
  ArucoDetector: AugmentedModule['aruco_ArucoDetector']
/**
   * Dictionary is a set of unique ArUco markers of the same size
   *
   * `bytesList` storing as 2-dimensions Mat with 4-th channels (CV_8UC4 type was used) and contains the marker codewords where:
   * - bytesList.rows is the dictionary size
   * - each marker is encoded using `nbytes = ceil(markerSize*markerSize/8.)` bytes
   * - each row contains all 4 rotations of the marker, so its length is `4*nbytes`
   * - the byte order in the bytesList[i] row:
   * `//bytes without rotation/bytes with rotation 1/bytes with rotation 2/bytes with rotation 3//`
   * So `bytesList.ptr(i)[k*nbytes + j]` is the j-th byte of i-th marker, in its k-th rotation.
   *
   * **Note:** Python bindings generate matrix with shape of bytesList `dictionary_size x nbytes x 4`,
   * but it should be indexed like C++ version. Python example for j-th byte of i-th marker, in its k-th rotation:
   * `aruco_dict.bytesList[id].ravel()[k*nbytes + j]`
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/objdetect/include/opencv2/objdetect/aruco_dictionary.hpp#L29
   */
  Dictionary: AugmentedModule['aruco_Dictionary']
/**
   * aruco charuco parameters value in the OpenCV API.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/objdetect/include/opencv2/objdetect/charuco_detector.hpp#L15
   */
  CharucoParameters: AugmentedModule['aruco_CharucoParameters']
/**
   * aruco charuco detector value in the OpenCV API.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/objdetect/include/opencv2/objdetect/charuco_detector.hpp#L37
   */
  CharucoDetector: AugmentedModule['aruco_CharucoDetector']
/**
   * Native enum entries for aruco corner refine method. Pass an entry to enum-typed arguments or its .value to numeric arguments.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/objdetect/include/opencv2/objdetect/aruco_detector.hpp#L16
   */
  CornerRefineMethod: AugmentedModule['aruco_CornerRefineMethod']
/**
   * Predefined markers dictionaries/sets
   *
   * Each dictionary indicates the number of bits and the number of markers contained
   * - DICT_ARUCO_ORIGINAL: standard ArUco Library Markers. 1024 markers, 5x5 bits, 0 minimum
   *                           distance
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/objdetect/include/opencv2/objdetect/aruco_dictionary.hpp#L108
   */
  PredefinedDictionaryType: AugmentedModule['aruco_PredefinedDictionaryType']
/**
   * Tag and corners detection based on the ArUco approach
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/objdetect/include/opencv2/objdetect/aruco_detector.hpp#L17
   */
  CORNER_REFINE_NONE: AugmentedModule['aruco_CORNER_REFINE_NONE']
/**
   * ArUco approach and refine the corners locations using corner subpixel accuracy
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/objdetect/include/opencv2/objdetect/aruco_detector.hpp#L18
   */
  CORNER_REFINE_SUBPIX: AugmentedModule['aruco_CORNER_REFINE_SUBPIX']
/**
   * ArUco approach and refine the corners locations using the contour-points line fitting
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/objdetect/include/opencv2/objdetect/aruco_detector.hpp#L19
   */
  CORNER_REFINE_CONTOUR: AugmentedModule['aruco_CORNER_REFINE_CONTOUR']
/**
   * Tag and corners detection based on the AprilTag 2 approach [wang2016iros]
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/objdetect/include/opencv2/objdetect/aruco_detector.hpp#L20
   */
  CORNER_REFINE_APRILTAG: AugmentedModule['aruco_CORNER_REFINE_APRILTAG']
/**
   * 4x4 bits, minimum hamming distance between any two codes = 4, 50 codes
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/objdetect/include/opencv2/objdetect/aruco_dictionary.hpp#L109
   */
  DICT_4X4_50: AugmentedModule['aruco_DICT_4X4_50']
/**
   * 4x4 bits, minimum hamming distance between any two codes = 3, 100 codes
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/objdetect/include/opencv2/objdetect/aruco_dictionary.hpp#L110
   */
  DICT_4X4_100: AugmentedModule['aruco_DICT_4X4_100']
/**
   * 4x4 bits, minimum hamming distance between any two codes = 3, 250 codes
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/objdetect/include/opencv2/objdetect/aruco_dictionary.hpp#L111
   */
  DICT_4X4_250: AugmentedModule['aruco_DICT_4X4_250']
/**
   * 4x4 bits, minimum hamming distance between any two codes = 2, 1000 codes
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/objdetect/include/opencv2/objdetect/aruco_dictionary.hpp#L112
   */
  DICT_4X4_1000: AugmentedModule['aruco_DICT_4X4_1000']
/**
   * 5x5 bits, minimum hamming distance between any two codes = 8, 50 codes
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/objdetect/include/opencv2/objdetect/aruco_dictionary.hpp#L113
   */
  DICT_5X5_50: AugmentedModule['aruco_DICT_5X5_50']
/**
   * 5x5 bits, minimum hamming distance between any two codes = 7, 100 codes
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/objdetect/include/opencv2/objdetect/aruco_dictionary.hpp#L114
   */
  DICT_5X5_100: AugmentedModule['aruco_DICT_5X5_100']
/**
   * 5x5 bits, minimum hamming distance between any two codes = 6, 250 codes
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/objdetect/include/opencv2/objdetect/aruco_dictionary.hpp#L115
   */
  DICT_5X5_250: AugmentedModule['aruco_DICT_5X5_250']
/**
   * 5x5 bits, minimum hamming distance between any two codes = 5, 1000 codes
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/objdetect/include/opencv2/objdetect/aruco_dictionary.hpp#L116
   */
  DICT_5X5_1000: AugmentedModule['aruco_DICT_5X5_1000']
/**
   * 6x6 bits, minimum hamming distance between any two codes = 13, 50 codes
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/objdetect/include/opencv2/objdetect/aruco_dictionary.hpp#L117
   */
  DICT_6X6_50: AugmentedModule['aruco_DICT_6X6_50']
/**
   * 6x6 bits, minimum hamming distance between any two codes = 12, 100 codes
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/objdetect/include/opencv2/objdetect/aruco_dictionary.hpp#L118
   */
  DICT_6X6_100: AugmentedModule['aruco_DICT_6X6_100']
/**
   * 6x6 bits, minimum hamming distance between any two codes = 11, 250 codes
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/objdetect/include/opencv2/objdetect/aruco_dictionary.hpp#L119
   */
  DICT_6X6_250: AugmentedModule['aruco_DICT_6X6_250']
/**
   * 6x6 bits, minimum hamming distance between any two codes = 9, 1000 codes
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/objdetect/include/opencv2/objdetect/aruco_dictionary.hpp#L120
   */
  DICT_6X6_1000: AugmentedModule['aruco_DICT_6X6_1000']
/**
   * 7x7 bits, minimum hamming distance between any two codes = 19, 50 codes
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/objdetect/include/opencv2/objdetect/aruco_dictionary.hpp#L121
   */
  DICT_7X7_50: AugmentedModule['aruco_DICT_7X7_50']
/**
   * 7x7 bits, minimum hamming distance between any two codes = 18, 100 codes
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/objdetect/include/opencv2/objdetect/aruco_dictionary.hpp#L122
   */
  DICT_7X7_100: AugmentedModule['aruco_DICT_7X7_100']
/**
   * 7x7 bits, minimum hamming distance between any two codes = 17, 250 codes
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/objdetect/include/opencv2/objdetect/aruco_dictionary.hpp#L123
   */
  DICT_7X7_250: AugmentedModule['aruco_DICT_7X7_250']
/**
   * 7x7 bits, minimum hamming distance between any two codes = 14, 1000 codes
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/objdetect/include/opencv2/objdetect/aruco_dictionary.hpp#L124
   */
  DICT_7X7_1000: AugmentedModule['aruco_DICT_7X7_1000']
/**
   * 6x6 bits, minimum hamming distance between any two codes = 3, 1024 codes
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/objdetect/include/opencv2/objdetect/aruco_dictionary.hpp#L125
   */
  DICT_ARUCO_ORIGINAL: AugmentedModule['aruco_DICT_ARUCO_ORIGINAL']
/**
   * 4x4 bits, minimum hamming distance between any two codes = 5, 30 codes
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/objdetect/include/opencv2/objdetect/aruco_dictionary.hpp#L126
   */
  DICT_APRILTAG_16h5: AugmentedModule['aruco_DICT_APRILTAG_16h5']
/**
   * 4x4 bits, minimum hamming distance between any two codes = 5, 30 codes
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/objdetect/include/opencv2/objdetect/aruco_dictionary.hpp#L126
   */
  DICT_APRILTAG_16H5: AugmentedModule['aruco_DICT_APRILTAG_16H5']
/**
   * 5x5 bits, minimum hamming distance between any two codes = 9, 35 codes
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/objdetect/include/opencv2/objdetect/aruco_dictionary.hpp#L127
   */
  DICT_APRILTAG_25h9: AugmentedModule['aruco_DICT_APRILTAG_25h9']
/**
   * 5x5 bits, minimum hamming distance between any two codes = 9, 35 codes
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/objdetect/include/opencv2/objdetect/aruco_dictionary.hpp#L127
   */
  DICT_APRILTAG_25H9: AugmentedModule['aruco_DICT_APRILTAG_25H9']
/**
   * 6x6 bits, minimum hamming distance between any two codes = 10, 2320 codes
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/objdetect/include/opencv2/objdetect/aruco_dictionary.hpp#L128
   */
  DICT_APRILTAG_36h10: AugmentedModule['aruco_DICT_APRILTAG_36h10']
/**
   * 6x6 bits, minimum hamming distance between any two codes = 10, 2320 codes
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/objdetect/include/opencv2/objdetect/aruco_dictionary.hpp#L128
   */
  DICT_APRILTAG_36H10: AugmentedModule['aruco_DICT_APRILTAG_36H10']
/**
   * 6x6 bits, minimum hamming distance between any two codes = 11, 587 codes
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/objdetect/include/opencv2/objdetect/aruco_dictionary.hpp#L129
   */
  DICT_APRILTAG_36h11: AugmentedModule['aruco_DICT_APRILTAG_36h11']
/**
   * 6x6 bits, minimum hamming distance between any two codes = 11, 587 codes
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/objdetect/include/opencv2/objdetect/aruco_dictionary.hpp#L129
   */
  DICT_APRILTAG_36H11: AugmentedModule['aruco_DICT_APRILTAG_36H11']
/**
   * 6x6 bits, minimum hamming distance between any two codes = 12, 250 codes
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/objdetect/include/opencv2/objdetect/aruco_dictionary.hpp#L130
   */
  DICT_ARUCO_MIP_36h12: AugmentedModule['aruco_DICT_ARUCO_MIP_36h12']
/**
   * 6x6 bits, minimum hamming distance between any two codes = 12, 250 codes
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/objdetect/include/opencv2/objdetect/aruco_dictionary.hpp#L130
   */
  DICT_ARUCO_MIP_36H12: AugmentedModule['aruco_DICT_ARUCO_MIP_36H12']
}
  /** Native barcode namespace. */
  barcode: CVNamespace<'barcode'> & {
/**
   * barcode barcode detector value in the OpenCV API.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/objdetect/include/opencv2/objdetect/barcode.hpp#L18
   */
  BarcodeDetector: AugmentedModule['barcode_BarcodeDetector']
}
  /** Native bgsegm namespace. */
  bgsegm: CVNamespace<'bgsegm'> & {
/**
   * Gaussian Mixture-based Background/Foreground Segmentation Algorithm.
   *
   * The class implements the algorithm described in [KB2001] .
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/bgsegm/include/opencv2/bgsegm.hpp#L62
   */
  BackgroundSubtractorMOG: AugmentedModule['bgsegm_BackgroundSubtractorMOG']
/**
   * Background Subtractor module based on the algorithm given in [Gold2012] .
   *
   *  Takes a series of images and returns a sequence of mask (8UC1)
   *  images of the same size, where 255 indicates Foreground and 0 represents Background.
   *  This class implements an algorithm described in "Visual Tracking of Human Visitors under
   *  Variable-Lighting Conditions for a Responsive Audio Art Installation," A. Godbehere,
   *  A. Matsukawa, K. Goldberg, American Control Conference, Montreal, June 2012.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/bgsegm/include/opencv2/bgsegm.hpp#L125
   */
  BackgroundSubtractorGMG: AugmentedModule['bgsegm_BackgroundSubtractorGMG']
/**
   * Background subtraction based on counting.
   *
   *   About as fast as MOG2 on a high end system.
   *   More than twice faster than MOG2 on cheap hardware (benchmarked on Raspberry Pi3).
   *
   *   %Algorithm by Sagi Zeevi ( https://github.com/sagi-z/BackgroundSubtractorCNT )
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/bgsegm/include/opencv2/bgsegm.hpp#L250
   */
  BackgroundSubtractorCNT: AugmentedModule['bgsegm_BackgroundSubtractorCNT']
/**
   * Implementation of the different yet better algorithm which is called GSOC, as it was implemented during GSOC and was not originated from any paper.
   *
   * This algorithm demonstrates better performance on CDNET 2014 dataset compared to other algorithms in OpenCV.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/bgsegm/include/opencv2/bgsegm.hpp#L325
   */
  BackgroundSubtractorGSOC: AugmentedModule['bgsegm_BackgroundSubtractorGSOC']
/**
   * Background Subtraction using Local SVD Binary Pattern. More details about the algorithm can be found at [LGuo2016]
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/bgsegm/include/opencv2/bgsegm.hpp#L337
   */
  BackgroundSubtractorLSBP: AugmentedModule['bgsegm_BackgroundSubtractorLSBP']
/**
   * This is for calculation of the LSBP descriptors.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/bgsegm/include/opencv2/bgsegm.hpp#L349
   */
  BackgroundSubtractorLSBPDesc: AugmentedModule['bgsegm_BackgroundSubtractorLSBPDesc']
/**
   * Synthetic frame sequence generator for testing background subtraction algorithms.
   *
   *  It will generate the moving object on top of the background.
   *  It will apply some distortion to the background to make the test more complex.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/bgsegm/include/opencv2/bgsegm.hpp#L402
   */
  SyntheticSequenceGenerator: AugmentedModule['bgsegm_SyntheticSequenceGenerator']
/**
   * Native enum entries for bgsegm lsbpcamera motion compensation. Pass an entry to enum-typed arguments or its .value to numeric arguments.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/bgsegm/include/opencv2/bgsegm.hpp#L316
   */
  LSBPCameraMotionCompensation: AugmentedModule['bgsegm_LSBPCameraMotionCompensation']
/**
   * bgsegm lsbp camera motion compensation none constant (0), defined by OpenCV for cv::bgsegm.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/bgsegm/include/opencv2/bgsegm.hpp#L317
   */
  LSBP_CAMERA_MOTION_COMPENSATION_NONE: AugmentedModule['bgsegm_LSBP_CAMERA_MOTION_COMPENSATION_NONE']
/**
   * bgsegm lsbp camera motion compensation lk constant (0+1), defined by OpenCV for cv::bgsegm.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/bgsegm/include/opencv2/bgsegm.hpp#L318
   */
  LSBP_CAMERA_MOTION_COMPENSATION_LK: AugmentedModule['bgsegm_LSBP_CAMERA_MOTION_COMPENSATION_LK']
}
  /** Native bioinspired namespace. */
  bioinspired: CVNamespace<'bioinspired'> & {
/**
   * class which allows the Gipsa/Listic Labs model to be used with OpenCV.
   *
   * This retina model allows spatio-temporal image processing (applied on still images, video sequences).
   * As a summary, these are the retina model properties:
   * - It applies a spectral whithening (mid-frequency details enhancement)
   * - high frequency spatio-temporal noise reduction
   * - low frequency luminance to be reduced (luminance range compression)
   * - local logarithmic luminance compression allows details to be enhanced in low light conditions
   *
   * USE : this model can be used basically for spatio-temporal video effects but also for :
   *      _using the getParvo method output matrix : texture analysiswith enhanced signal to noise ratio and enhanced details robust against input images luminance ranges
   *      _using the getMagno method output matrix : motion analysis also with the previously cited properties
   *
   * for more information, reer to the following papers :
   * Benoit A., Caplier A., Durette B., Herault, J., "USING HUMAN VISUAL SYSTEM MODELING FOR BIO-INSPIRED LOW LEVEL IMAGE PROCESSING", Elsevier, Computer Vision and Image Understanding 114 (2010), pp. 758-773, DOI: http://dx.doi.org/10.1016/j.cviu.2010.01.011
   * Vision: Images, Signals and Neural Networks: Models of Neural Processing in Visual Perception (Progress in Neural Processing),By: Jeanny Herault, ISBN: 9814273686. WAPI (Tower ID): 113266891.
   *
   * The retina filter includes the research contributions of phd/research collegues from which code has been redrawn by the author :
   * take a look at the retinacolor.hpp module to discover Brice Chaix de Lavarene color mosaicing/demosaicing and the reference paper:
   * B. Chaix de Lavarene, D. Alleysson, B. Durette, J. Herault (2007). "Efficient demosaicing through recursive filtering", IEEE International Conference on Image Processing ICIP 2007
   * take a look at imagelogpolprojection.hpp to discover retina spatial log sampling which originates from Barthelemy Durette phd with Jeanny Herault. A Retina / V1 cortex projection is also proposed and originates from Jeanny's discussions.
   * more informations in the above cited Jeanny Heraults's book.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/bioinspired/include/opencv2/bioinspired/retina.hpp#L162
   */
  Retina: AugmentedModule['bioinspired_Retina']
/**
   * a wrapper class which allows the tone mapping algorithm of Meylan&al(2007) to be used with OpenCV.
   *
   * This algorithm is already implemented in thre Retina class (retina::applyFastToneMapping) but used it does not require all the retina model to be allocated. This allows a light memory use for low memory devices (smartphones, etc.
   * As a summary, these are the model properties:
   * - 2 stages of local luminance adaptation with a different local neighborhood for each.
   * - first stage models the retina photorecetors local luminance adaptation
   * - second stage models th ganglion cells local information adaptation
   * - compared to the initial publication, this class uses spatio-temporal low pass filters instead of spatial only filters.
   *   this can help noise robustness and temporal stability for video sequence use cases.
   *
   * for more information, read to the following papers :
   * Meylan L., Alleysson D., and Susstrunk S., A Model of Retinal Local Adaptation for the Tone Mapping of Color Filter Array Images, Journal of Optical Society of America, A, Vol. 24, N 9, September, 1st, 2007, pp. 2807-2816Benoit A., Caplier A., Durette B., Herault, J., "USING HUMAN VISUAL SYSTEM MODELING FOR BIO-INSPIRED LOW LEVEL IMAGE PROCESSING", Elsevier, Computer Vision and Image Understanding 114 (2010), pp. 758-773, DOI: http://dx.doi.org/10.1016/j.cviu.2010.01.011
   * regarding spatio-temporal filter and the bigger retina model :
   * Vision: Images, Signals and Neural Networks: Models of Neural Processing in Visual Perception (Progress in Neural Processing),By: Jeanny Herault, ISBN: 9814273686. WAPI (Tower ID): 113266891.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/bioinspired/include/opencv2/bioinspired/retinafasttonemapping.hpp#L99
   */
  RetinaFastToneMapping: AugmentedModule['bioinspired_RetinaFastToneMapping']
/**
   * class which provides a transient/moving areas segmentation module
   *
   * perform a locally adapted segmentation by using the retina magno input data Based on Alexandre
   * BENOIT thesis: "Le système visuel humain au secours de la vision par ordinateur"
   *
   * 3 spatio temporal filters are used:
   * - a first one which filters the noise and local variations of the input motion energy
   * - a second (more powerfull low pass spatial filter) which gives the neighborhood motion energy the
   * segmentation consists in the comparison of these both outputs, if the local motion energy is higher
   * to the neighborhood otion energy, then the area is considered as moving and is segmented
   * - a stronger third low pass filter helps decision by providing a smooth information about the
   * "motion context" in a wider area
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/bioinspired/include/opencv2/bioinspired/transientareassegmentationmodule.hpp#L122
   */
  TransientAreasSegmentationModule: AugmentedModule['bioinspired_TransientAreasSegmentationModule']
/**
   * each pixel position is either R, G or B in a random choice
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/bioinspired/include/opencv2/bioinspired/retina.hpp#L84
   */
  RETINA_COLOR_RANDOM: AugmentedModule['bioinspired_RETINA_COLOR_RANDOM']
/**
   * color sampling is RGBRGBRGB..., line 2 BRGBRGBRG..., line 3, GBRGBRGBR...
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/bioinspired/include/opencv2/bioinspired/retina.hpp#L85
   */
  RETINA_COLOR_DIAGONAL: AugmentedModule['bioinspired_RETINA_COLOR_DIAGONAL']
/**
   * standard bayer sampling
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/bioinspired/include/opencv2/bioinspired/retina.hpp#L86
   */
  RETINA_COLOR_BAYER: AugmentedModule['bioinspired_RETINA_COLOR_BAYER']
}
  /** Native ccm namespace. */
  ccm: CVNamespace<'ccm'> & {
/**
   * Core class of ccm model
   *
   * Produce a ColorCorrectionModel instance for inference
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/photo/include/opencv2/photo/ccm.hpp#L144
   */
  ColorCorrectionModel: AugmentedModule['ccm_ColorCorrectionModel']
/**
   * Enum of the possible types of ccm.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/photo/include/opencv2/photo/ccm.hpp#L26
   */
  CcmType: AugmentedModule['ccm_CcmType']
/**
   * Enum of the possible types of initial method.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/photo/include/opencv2/photo/ccm.hpp#L34
   */
  InitialMethodType: AugmentedModule['ccm_InitialMethodType']
/**
   * Macbeth and Vinyl ColorChecker with 2deg D50
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/photo/include/opencv2/photo/ccm.hpp#L55
   */
  ColorCheckerType: AugmentedModule['ccm_ColorCheckerType']
/**
   * Native enum entries for ccm color space. Pass an entry to enum-typed arguments or its .value to numeric arguments.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/photo/include/opencv2/photo/ccm.hpp#L60
   */
  ColorSpace: AugmentedModule['ccm_ColorSpace']
/**
   * Linearization transformation type
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/photo/include/opencv2/photo/ccm.hpp#L105
   */
  LinearizationType: AugmentedModule['ccm_LinearizationType']
/**
   * Enum of possible functions to calculate the distance between colors.
   *
   * See https://en.wikipedia.org/wiki/Color_difference for details
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/photo/include/opencv2/photo/ccm.hpp#L120
   */
  DistanceType: AugmentedModule['ccm_DistanceType']
/**
   * Uses a `3\times3` matrix to linearly transform RGB values without offsets.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/photo/include/opencv2/photo/ccm.hpp#L28
   */
  CCM_LINEAR: AugmentedModule['ccm_CCM_LINEAR']
/**
   * Uses a `4\times3` matrix to affine transform RGB values with both scaling and offset terms.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/photo/include/opencv2/photo/ccm.hpp#L29
   */
  CCM_AFFINE: AugmentedModule['ccm_CCM_AFFINE']
/**
   * The white balance method. The initial value is:\n
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/photo/include/opencv2/photo/ccm.hpp#L36
   */
  INITIAL_METHOD_WHITE_BALANCE: AugmentedModule['ccm_INITIAL_METHOD_WHITE_BALANCE']
/**
   * The least square method is an optimal solution under the linear RGB distance function
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/photo/include/opencv2/photo/ccm.hpp#L51
   */
  INITIAL_METHOD_LEAST_SQUARE: AugmentedModule['ccm_INITIAL_METHOD_LEAST_SQUARE']
/**
   * Macbeth ColorChecker
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/photo/include/opencv2/photo/ccm.hpp#L56
   */
  COLORCHECKER_MACBETH: AugmentedModule['ccm_COLORCHECKER_MACBETH']
/**
   * DKK ColorChecker
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/photo/include/opencv2/photo/ccm.hpp#L57
   */
  COLORCHECKER_VINYL: AugmentedModule['ccm_COLORCHECKER_VINYL']
/**
   * DigitalSG ColorChecker with 140 squares
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/photo/include/opencv2/photo/ccm.hpp#L58
   */
  COLORCHECKER_DIGITAL_SG: AugmentedModule['ccm_COLORCHECKER_DIGITAL_SG']
/**
   * https://en.wikipedia.org/wiki/SRGB , RGB color space
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/photo/include/opencv2/photo/ccm.hpp#L61
   */
  COLOR_SPACE_SRGB: AugmentedModule['ccm_COLOR_SPACE_SRGB']
/**
   * https://en.wikipedia.org/wiki/SRGB , linear RGB color space
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/photo/include/opencv2/photo/ccm.hpp#L62
   */
  COLOR_SPACE_SRGBL: AugmentedModule['ccm_COLOR_SPACE_SRGBL']
/**
   * https://en.wikipedia.org/wiki/Adobe_RGB_color_space , RGB color space
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/photo/include/opencv2/photo/ccm.hpp#L63
   */
  COLOR_SPACE_ADOBE_RGB: AugmentedModule['ccm_COLOR_SPACE_ADOBE_RGB']
/**
   * https://en.wikipedia.org/wiki/Adobe_RGB_color_space , linear RGB color space
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/photo/include/opencv2/photo/ccm.hpp#L64
   */
  COLOR_SPACE_ADOBE_RGBL: AugmentedModule['ccm_COLOR_SPACE_ADOBE_RGBL']
/**
   * https://en.wikipedia.org/wiki/Wide-gamut_RGB_color_space , RGB color space
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/photo/include/opencv2/photo/ccm.hpp#L65
   */
  COLOR_SPACE_WIDE_GAMUT_RGB: AugmentedModule['ccm_COLOR_SPACE_WIDE_GAMUT_RGB']
/**
   * https://en.wikipedia.org/wiki/Wide-gamut_RGB_color_space , linear RGB color space
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/photo/include/opencv2/photo/ccm.hpp#L66
   */
  COLOR_SPACE_WIDE_GAMUT_RGBL: AugmentedModule['ccm_COLOR_SPACE_WIDE_GAMUT_RGBL']
/**
   * https://en.wikipedia.org/wiki/ProPhoto_RGB_color_space , RGB color space
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/photo/include/opencv2/photo/ccm.hpp#L67
   */
  COLOR_SPACE_PRO_PHOTO_RGB: AugmentedModule['ccm_COLOR_SPACE_PRO_PHOTO_RGB']
/**
   * https://en.wikipedia.org/wiki/ProPhoto_RGB_color_space , linear RGB color space
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/photo/include/opencv2/photo/ccm.hpp#L68
   */
  COLOR_SPACE_PRO_PHOTO_RGBL: AugmentedModule['ccm_COLOR_SPACE_PRO_PHOTO_RGBL']
/**
   * https://en.wikipedia.org/wiki/DCI-P3 , RGB color space
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/photo/include/opencv2/photo/ccm.hpp#L69
   */
  COLOR_SPACE_DCI_P3_RGB: AugmentedModule['ccm_COLOR_SPACE_DCI_P3_RGB']
/**
   * https://en.wikipedia.org/wiki/DCI-P3 , linear RGB color space
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/photo/include/opencv2/photo/ccm.hpp#L70
   */
  COLOR_SPACE_DCI_P3_RGBL: AugmentedModule['ccm_COLOR_SPACE_DCI_P3_RGBL']
/**
   * http://www.brucelindbloom.com/index.html?WorkingSpaceInfo.html , RGB color space
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/photo/include/opencv2/photo/ccm.hpp#L71
   */
  COLOR_SPACE_APPLE_RGB: AugmentedModule['ccm_COLOR_SPACE_APPLE_RGB']
/**
   * http://www.brucelindbloom.com/index.html?WorkingSpaceInfo.html , linear RGB color space
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/photo/include/opencv2/photo/ccm.hpp#L72
   */
  COLOR_SPACE_APPLE_RGBL: AugmentedModule['ccm_COLOR_SPACE_APPLE_RGBL']
/**
   * https://en.wikipedia.org/wiki/Rec._709 , RGB color space
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/photo/include/opencv2/photo/ccm.hpp#L73
   */
  COLOR_SPACE_REC_709_RGB: AugmentedModule['ccm_COLOR_SPACE_REC_709_RGB']
/**
   * https://en.wikipedia.org/wiki/Rec._709 , linear RGB color space
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/photo/include/opencv2/photo/ccm.hpp#L74
   */
  COLOR_SPACE_REC_709_RGBL: AugmentedModule['ccm_COLOR_SPACE_REC_709_RGBL']
/**
   * https://en.wikipedia.org/wiki/Rec._2020 , RGB color space
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/photo/include/opencv2/photo/ccm.hpp#L75
   */
  COLOR_SPACE_REC_2020_RGB: AugmentedModule['ccm_COLOR_SPACE_REC_2020_RGB']
/**
   * https://en.wikipedia.org/wiki/Rec._2020 , linear RGB color space
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/photo/include/opencv2/photo/ccm.hpp#L76
   */
  COLOR_SPACE_REC_2020_RGBL: AugmentedModule['ccm_COLOR_SPACE_REC_2020_RGBL']
/**
   * https://en.wikipedia.org/wiki/CIE_1931_color_space , XYZ color space, D65 illuminant, 2 degree
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/photo/include/opencv2/photo/ccm.hpp#L77
   */
  COLOR_SPACE_XYZ_D65_2: AugmentedModule['ccm_COLOR_SPACE_XYZ_D65_2']
/**
   * https://en.wikipedia.org/wiki/CIE_1931_color_space , XYZ color space, D50 illuminant, 2 degree
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/photo/include/opencv2/photo/ccm.hpp#L78
   */
  COLOR_SPACE_XYZ_D50_2: AugmentedModule['ccm_COLOR_SPACE_XYZ_D50_2']
/**
   * https://en.wikipedia.org/wiki/CIE_1931_color_space , XYZ color space, D65 illuminant, 10 degree
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/photo/include/opencv2/photo/ccm.hpp#L79
   */
  COLOR_SPACE_XYZ_D65_10: AugmentedModule['ccm_COLOR_SPACE_XYZ_D65_10']
/**
   * https://en.wikipedia.org/wiki/CIE_1931_color_space , XYZ color space, D50 illuminant, 10 degree
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/photo/include/opencv2/photo/ccm.hpp#L80
   */
  COLOR_SPACE_XYZ_D50_10: AugmentedModule['ccm_COLOR_SPACE_XYZ_D50_10']
/**
   * https://en.wikipedia.org/wiki/CIE_1931_color_space , XYZ color space, A illuminant, 2 degree
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/photo/include/opencv2/photo/ccm.hpp#L81
   */
  COLOR_SPACE_XYZ_A_2: AugmentedModule['ccm_COLOR_SPACE_XYZ_A_2']
/**
   * https://en.wikipedia.org/wiki/CIE_1931_color_space , XYZ color space, A illuminant, 10 degree
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/photo/include/opencv2/photo/ccm.hpp#L82
   */
  COLOR_SPACE_XYZ_A_10: AugmentedModule['ccm_COLOR_SPACE_XYZ_A_10']
/**
   * https://en.wikipedia.org/wiki/CIE_1931_color_space , XYZ color space, D55 illuminant, 2 degree
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/photo/include/opencv2/photo/ccm.hpp#L83
   */
  COLOR_SPACE_XYZ_D55_2: AugmentedModule['ccm_COLOR_SPACE_XYZ_D55_2']
/**
   * https://en.wikipedia.org/wiki/CIE_1931_color_space , XYZ color space, D55 illuminant, 10 degree
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/photo/include/opencv2/photo/ccm.hpp#L84
   */
  COLOR_SPACE_XYZ_D55_10: AugmentedModule['ccm_COLOR_SPACE_XYZ_D55_10']
/**
   * https://en.wikipedia.org/wiki/CIE_1931_color_space , XYZ color space, D75 illuminant, 2 degree
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/photo/include/opencv2/photo/ccm.hpp#L85
   */
  COLOR_SPACE_XYZ_D75_2: AugmentedModule['ccm_COLOR_SPACE_XYZ_D75_2']
/**
   * https://en.wikipedia.org/wiki/CIE_1931_color_space , XYZ color space, D75 illuminant, 10 degree
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/photo/include/opencv2/photo/ccm.hpp#L86
   */
  COLOR_SPACE_XYZ_D75_10: AugmentedModule['ccm_COLOR_SPACE_XYZ_D75_10']
/**
   * https://en.wikipedia.org/wiki/CIE_1931_color_space , XYZ color space, E illuminant, 2 degree
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/photo/include/opencv2/photo/ccm.hpp#L87
   */
  COLOR_SPACE_XYZ_E_2: AugmentedModule['ccm_COLOR_SPACE_XYZ_E_2']
/**
   * https://en.wikipedia.org/wiki/CIE_1931_color_space , XYZ color space, E illuminant, 10 degree
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/photo/include/opencv2/photo/ccm.hpp#L88
   */
  COLOR_SPACE_XYZ_E_10: AugmentedModule['ccm_COLOR_SPACE_XYZ_E_10']
/**
   * https://en.wikipedia.org/wiki/CIELAB_color_space , Lab color space, D65 illuminant, 2 degree
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/photo/include/opencv2/photo/ccm.hpp#L89
   */
  COLOR_SPACE_LAB_D65_2: AugmentedModule['ccm_COLOR_SPACE_LAB_D65_2']
/**
   * https://en.wikipedia.org/wiki/CIELAB_color_space , Lab color space, D50 illuminant, 2 degree
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/photo/include/opencv2/photo/ccm.hpp#L90
   */
  COLOR_SPACE_LAB_D50_2: AugmentedModule['ccm_COLOR_SPACE_LAB_D50_2']
/**
   * https://en.wikipedia.org/wiki/CIELAB_color_space , Lab color space, D65 illuminant, 10 degree
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/photo/include/opencv2/photo/ccm.hpp#L91
   */
  COLOR_SPACE_LAB_D65_10: AugmentedModule['ccm_COLOR_SPACE_LAB_D65_10']
/**
   * https://en.wikipedia.org/wiki/CIELAB_color_space , Lab color space, D50 illuminant, 10 degree
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/photo/include/opencv2/photo/ccm.hpp#L92
   */
  COLOR_SPACE_LAB_D50_10: AugmentedModule['ccm_COLOR_SPACE_LAB_D50_10']
/**
   * https://en.wikipedia.org/wiki/CIELAB_color_space , Lab color space, A illuminant, 2 degree
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/photo/include/opencv2/photo/ccm.hpp#L93
   */
  COLOR_SPACE_LAB_A_2: AugmentedModule['ccm_COLOR_SPACE_LAB_A_2']
/**
   * https://en.wikipedia.org/wiki/CIELAB_color_space , Lab color space, A illuminant, 10 degree
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/photo/include/opencv2/photo/ccm.hpp#L94
   */
  COLOR_SPACE_LAB_A_10: AugmentedModule['ccm_COLOR_SPACE_LAB_A_10']
/**
   * https://en.wikipedia.org/wiki/CIELAB_color_space , Lab color space, D55 illuminant, 2 degree
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/photo/include/opencv2/photo/ccm.hpp#L95
   */
  COLOR_SPACE_LAB_D55_2: AugmentedModule['ccm_COLOR_SPACE_LAB_D55_2']
/**
   * https://en.wikipedia.org/wiki/CIELAB_color_space , Lab color space, D55 illuminant, 10 degree
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/photo/include/opencv2/photo/ccm.hpp#L96
   */
  COLOR_SPACE_LAB_D55_10: AugmentedModule['ccm_COLOR_SPACE_LAB_D55_10']
/**
   * https://en.wikipedia.org/wiki/CIELAB_color_space , Lab color space, D75 illuminant, 2 degree
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/photo/include/opencv2/photo/ccm.hpp#L97
   */
  COLOR_SPACE_LAB_D75_2: AugmentedModule['ccm_COLOR_SPACE_LAB_D75_2']
/**
   * https://en.wikipedia.org/wiki/CIELAB_color_space , Lab color space, D75 illuminant, 10 degree
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/photo/include/opencv2/photo/ccm.hpp#L98
   */
  COLOR_SPACE_LAB_D75_10: AugmentedModule['ccm_COLOR_SPACE_LAB_D75_10']
/**
   * https://en.wikipedia.org/wiki/CIELAB_color_space , Lab color space, E illuminant, 2 degree
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/photo/include/opencv2/photo/ccm.hpp#L99
   */
  COLOR_SPACE_LAB_E_2: AugmentedModule['ccm_COLOR_SPACE_LAB_E_2']
/**
   * https://en.wikipedia.org/wiki/CIELAB_color_space , Lab color space, E illuminant, 10 degree
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/photo/include/opencv2/photo/ccm.hpp#L100
   */
  COLOR_SPACE_LAB_E_10: AugmentedModule['ccm_COLOR_SPACE_LAB_E_10']
/**
   * no change is made
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/photo/include/opencv2/photo/ccm.hpp#L108
   */
  LINEARIZATION_IDENTITY: AugmentedModule['ccm_LINEARIZATION_IDENTITY']
/**
   * gamma correction; Need assign a value to gamma simultaneously
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/photo/include/opencv2/photo/ccm.hpp#L109
   */
  LINEARIZATION_GAMMA: AugmentedModule['ccm_LINEARIZATION_GAMMA']
/**
   * polynomial fitting channels respectively; Need assign a value to deg simultaneously
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/photo/include/opencv2/photo/ccm.hpp#L110
   */
  LINEARIZATION_COLORPOLYFIT: AugmentedModule['ccm_LINEARIZATION_COLORPOLYFIT']
/**
   * logarithmic polynomial fitting channels respectively; Need assign a value to deg simultaneously
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/photo/include/opencv2/photo/ccm.hpp#L111
   */
  LINEARIZATION_COLORLOGPOLYFIT: AugmentedModule['ccm_LINEARIZATION_COLORLOGPOLYFIT']
/**
   * grayscale polynomial fitting; Need assign a value to deg and dst_whites simultaneously
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/photo/include/opencv2/photo/ccm.hpp#L112
   */
  LINEARIZATION_GRAYPOLYFIT: AugmentedModule['ccm_LINEARIZATION_GRAYPOLYFIT']
/**
   * grayscale Logarithmic polynomial fitting;  Need assign a value to deg and dst_whites simultaneously
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/photo/include/opencv2/photo/ccm.hpp#L113
   */
  LINEARIZATION_GRAYLOGPOLYFIT: AugmentedModule['ccm_LINEARIZATION_GRAYLOGPOLYFIT']
/**
   * The 1976 formula is the first formula that related a measured color difference to a known set of CIELAB coordinates.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/photo/include/opencv2/photo/ccm.hpp#L122
   */
  DISTANCE_CIE76: AugmentedModule['ccm_DISTANCE_CIE76']
/**
   * The 1976 definition was extended to address perceptual non-uniformities.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/photo/include/opencv2/photo/ccm.hpp#L123
   */
  DISTANCE_CIE94_GRAPHIC_ARTS: AugmentedModule['ccm_DISTANCE_CIE94_GRAPHIC_ARTS']
/**
   * The 1976 definition was extended to address perceptual non-uniformities.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/photo/include/opencv2/photo/ccm.hpp#L124
   */
  DISTANCE_CIE94_TEXTILES: AugmentedModule['ccm_DISTANCE_CIE94_TEXTILES']
/**
   * ccm distance cie2000 constant (3), defined by OpenCV for cv::ccm.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/photo/include/opencv2/photo/ccm.hpp#L125
   */
  DISTANCE_CIE2000: AugmentedModule['ccm_DISTANCE_CIE2000']
/**
   * In 1984, the Colour Measurement Committee of the Society of Dyers and Colourists defined a difference measure, also based on the L*C*h color model.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/photo/include/opencv2/photo/ccm.hpp#L126
   */
  DISTANCE_CMC_1TO1: AugmentedModule['ccm_DISTANCE_CMC_1TO1']
/**
   * In 1984, the Colour Measurement Committee of the Society of Dyers and Colourists defined a difference measure, also based on the L*C*h color model.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/photo/include/opencv2/photo/ccm.hpp#L127
   */
  DISTANCE_CMC_2TO1: AugmentedModule['ccm_DISTANCE_CMC_2TO1']
/**
   * Euclidean distance of rgb color space
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/photo/include/opencv2/photo/ccm.hpp#L128
   */
  DISTANCE_RGB: AugmentedModule['ccm_DISTANCE_RGB']
/**
   * Euclidean distance of rgbl color space
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/photo/include/opencv2/photo/ccm.hpp#L129
   */
  DISTANCE_RGBL: AugmentedModule['ccm_DISTANCE_RGBL']
}
  /** Native colored_kinfu namespace. */
  colored_kinfu: CVNamespace<'colored_kinfu'> & {
/**
   * colored kinfu params value in the OpenCV API.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/rgbd/include/opencv2/rgbd/colored_kinfu.hpp#L19
   */
  Params: AugmentedModule['colored_kinfu_Params']
/**
   * KinectFusion implementation
   *
   *   This class implements a 3d reconstruction algorithm described in
   *   [kinectfusion] paper.
   *
   *   It takes a sequence of depth images taken from depth sensor
   *   (or any depth images source such as stereo camera matching algorithm or even raymarching renderer).
   *   The output can be obtained as a vector of points and their normals
   *   or can be Phong-rendered from given camera pose.
   *
   *   An internal representation of a model is a voxel cuboid that keeps TSDF values
   *   which are a sort of distances to the surface (for details read the [kinectfusion] article about TSDF).
   *   There is no interface to that representation yet.
   *
   *   KinFu uses OpenCL acceleration automatically if available.
   *   To enable or disable it explicitly use cv::setUseOptimized() or cv::ocl::setUseOpenCL().
   *
   *   This implementation is based on [kinfu-remake](https://github.com/Nerei/kinfu_remake).
   *
   *   Note that the KinectFusion algorithm was patented and its use may be restricted by
   *   the list of patents mentioned in README.md file in this module directory.
   *
   *   That's why you need to set the OPENCV_ENABLE_NONFREE option in CMake to use KinectFusion.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/rgbd/include/opencv2/rgbd/colored_kinfu.hpp#L197
   */
  ColoredKinFu: AugmentedModule['colored_kinfu_ColoredKinFu']
}
  /** Native datasets namespace. */
  datasets: CVNamespace<'datasets'> & {
/**
   * Native enum entries for datasets gender type. Pass an entry to enum-typed arguments or its .value to numeric arguments.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/datasets/include/opencv2/datasets/fr_adience.hpp#L60
   */
  genderType: AugmentedModule['datasets_genderType']
/**
   * Native enum entries for datasets action type. Pass an entry to enum-typed arguments or its .value to numeric arguments.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/datasets/include/opencv2/datasets/gr_skig.hpp#L60
   */
  actionType: AugmentedModule['datasets_actionType']
/**
   * Native enum entries for datasets pose type. Pass an entry to enum-typed arguments or its .value to numeric arguments.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/datasets/include/opencv2/datasets/gr_skig.hpp#L74
   */
  poseType: AugmentedModule['datasets_poseType']
/**
   * Native enum entries for datasets illumination type. Pass an entry to enum-typed arguments or its .value to numeric arguments.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/datasets/include/opencv2/datasets/gr_skig.hpp#L81
   */
  illuminationType: AugmentedModule['datasets_illuminationType']
/**
   * Native enum entries for datasets background type. Pass an entry to enum-typed arguments or its .value to numeric arguments.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/datasets/include/opencv2/datasets/gr_skig.hpp#L87
   */
  backgroundType: AugmentedModule['datasets_backgroundType']
/**
   * Native enum entries for datasets dataset type. Pass an entry to enum-typed arguments or its .value to numeric arguments.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/datasets/include/opencv2/datasets/hpe_humaneva.hpp#L71
   */
  datasetType: AugmentedModule['datasets_datasetType']
/**
   * Native enum entries for datasets sample type. Pass an entry to enum-typed arguments or its .value to numeric arguments.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/datasets/include/opencv2/datasets/pd_inria.hpp#L60
   */
  sampleType: AugmentedModule['datasets_sampleType']
/**
   * Native enum entries for datasets image type. Pass an entry to enum-typed arguments or its .value to numeric arguments.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/datasets/include/opencv2/datasets/slam_tumindoor.hpp#L60
   */
  imageType: AugmentedModule['datasets_imageType']
/**
   * datasets male constant (0), defined by OpenCV for cv::datasets.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/datasets/include/opencv2/datasets/fr_adience.hpp#L62
   */
  male: AugmentedModule['datasets_male']
/**
   * datasets male constant (0), defined by OpenCV for cv::datasets.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/datasets/include/opencv2/datasets/fr_adience.hpp#L62
   */
  MALE: AugmentedModule['datasets_MALE']
/**
   * datasets female constant (0+1), defined by OpenCV for cv::datasets.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/datasets/include/opencv2/datasets/fr_adience.hpp#L63
   */
  female: AugmentedModule['datasets_female']
/**
   * datasets female constant (0+1), defined by OpenCV for cv::datasets.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/datasets/include/opencv2/datasets/fr_adience.hpp#L63
   */
  FEMALE: AugmentedModule['datasets_FEMALE']
/**
   * datasets none constant (0+2), defined by OpenCV for cv::datasets.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/datasets/include/opencv2/datasets/fr_adience.hpp#L64
   */
  none: AugmentedModule['datasets_none']
/**
   * datasets none constant (0+2), defined by OpenCV for cv::datasets.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/datasets/include/opencv2/datasets/fr_adience.hpp#L64
   */
  NONE: AugmentedModule['datasets_NONE']
/**
   * datasets circle constant (1), defined by OpenCV for cv::datasets.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/datasets/include/opencv2/datasets/gr_skig.hpp#L62
   */
  circle: AugmentedModule['datasets_circle']
/**
   * datasets circle constant (1), defined by OpenCV for cv::datasets.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/datasets/include/opencv2/datasets/gr_skig.hpp#L62
   */
  CIRCLE: AugmentedModule['datasets_CIRCLE']
/**
   * datasets triangle constant (1+1), defined by OpenCV for cv::datasets.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/datasets/include/opencv2/datasets/gr_skig.hpp#L63
   */
  triangle: AugmentedModule['datasets_triangle']
/**
   * datasets triangle constant (1+1), defined by OpenCV for cv::datasets.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/datasets/include/opencv2/datasets/gr_skig.hpp#L63
   */
  TRIANGLE: AugmentedModule['datasets_TRIANGLE']
/**
   * datasets updown constant (1+2), defined by OpenCV for cv::datasets.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/datasets/include/opencv2/datasets/gr_skig.hpp#L64
   */
  updown: AugmentedModule['datasets_updown']
/**
   * datasets updown constant (1+2), defined by OpenCV for cv::datasets.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/datasets/include/opencv2/datasets/gr_skig.hpp#L64
   */
  UPDOWN: AugmentedModule['datasets_UPDOWN']
/**
   * datasets rightleft constant (1+3), defined by OpenCV for cv::datasets.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/datasets/include/opencv2/datasets/gr_skig.hpp#L65
   */
  rightleft: AugmentedModule['datasets_rightleft']
/**
   * datasets rightleft constant (1+3), defined by OpenCV for cv::datasets.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/datasets/include/opencv2/datasets/gr_skig.hpp#L65
   */
  RIGHTLEFT: AugmentedModule['datasets_RIGHTLEFT']
/**
   * datasets wave constant (1+4), defined by OpenCV for cv::datasets.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/datasets/include/opencv2/datasets/gr_skig.hpp#L66
   */
  wave: AugmentedModule['datasets_wave']
/**
   * datasets wave constant (1+4), defined by OpenCV for cv::datasets.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/datasets/include/opencv2/datasets/gr_skig.hpp#L66
   */
  WAVE: AugmentedModule['datasets_WAVE']
/**
   * datasets z constant (1+5), defined by OpenCV for cv::datasets.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/datasets/include/opencv2/datasets/gr_skig.hpp#L67
   */
  z: AugmentedModule['datasets_z']
/**
   * datasets z constant (1+5), defined by OpenCV for cv::datasets.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/datasets/include/opencv2/datasets/gr_skig.hpp#L67
   */
  Z: AugmentedModule['datasets_Z']
/**
   * datasets cross constant (1+6), defined by OpenCV for cv::datasets.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/datasets/include/opencv2/datasets/gr_skig.hpp#L68
   */
  cross: AugmentedModule['datasets_cross']
/**
   * datasets cross constant (1+6), defined by OpenCV for cv::datasets.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/datasets/include/opencv2/datasets/gr_skig.hpp#L68
   */
  CROSS: AugmentedModule['datasets_CROSS']
/**
   * datasets comehere constant (1+7), defined by OpenCV for cv::datasets.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/datasets/include/opencv2/datasets/gr_skig.hpp#L69
   */
  comehere: AugmentedModule['datasets_comehere']
/**
   * datasets comehere constant (1+7), defined by OpenCV for cv::datasets.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/datasets/include/opencv2/datasets/gr_skig.hpp#L69
   */
  COMEHERE: AugmentedModule['datasets_COMEHERE']
/**
   * datasets turnaround constant (1+8), defined by OpenCV for cv::datasets.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/datasets/include/opencv2/datasets/gr_skig.hpp#L70
   */
  turnaround: AugmentedModule['datasets_turnaround']
/**
   * datasets turnaround constant (1+8), defined by OpenCV for cv::datasets.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/datasets/include/opencv2/datasets/gr_skig.hpp#L70
   */
  TURNAROUND: AugmentedModule['datasets_TURNAROUND']
/**
   * datasets pat constant (1+9), defined by OpenCV for cv::datasets.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/datasets/include/opencv2/datasets/gr_skig.hpp#L71
   */
  pat: AugmentedModule['datasets_pat']
/**
   * datasets pat constant (1+9), defined by OpenCV for cv::datasets.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/datasets/include/opencv2/datasets/gr_skig.hpp#L71
   */
  PAT: AugmentedModule['datasets_PAT']
/**
   * datasets fist constant (1), defined by OpenCV for cv::datasets.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/datasets/include/opencv2/datasets/gr_skig.hpp#L76
   */
  fist: AugmentedModule['datasets_fist']
/**
   * datasets fist constant (1), defined by OpenCV for cv::datasets.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/datasets/include/opencv2/datasets/gr_skig.hpp#L76
   */
  FIST: AugmentedModule['datasets_FIST']
/**
   * datasets index constant (1+1), defined by OpenCV for cv::datasets.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/datasets/include/opencv2/datasets/gr_skig.hpp#L77
   */
  index: AugmentedModule['datasets_index']
/**
   * datasets index constant (1+1), defined by OpenCV for cv::datasets.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/datasets/include/opencv2/datasets/gr_skig.hpp#L77
   */
  INDEX: AugmentedModule['datasets_INDEX']
/**
   * datasets flat constant (1+2), defined by OpenCV for cv::datasets.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/datasets/include/opencv2/datasets/gr_skig.hpp#L78
   */
  flat: AugmentedModule['datasets_flat']
/**
   * datasets flat constant (1+2), defined by OpenCV for cv::datasets.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/datasets/include/opencv2/datasets/gr_skig.hpp#L78
   */
  FLAT: AugmentedModule['datasets_FLAT']
/**
   * datasets light constant (1), defined by OpenCV for cv::datasets.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/datasets/include/opencv2/datasets/gr_skig.hpp#L83
   */
  light: AugmentedModule['datasets_light']
/**
   * datasets light constant (1), defined by OpenCV for cv::datasets.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/datasets/include/opencv2/datasets/gr_skig.hpp#L83
   */
  LIGHT: AugmentedModule['datasets_LIGHT']
/**
   * datasets dark constant (1+1), defined by OpenCV for cv::datasets.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/datasets/include/opencv2/datasets/gr_skig.hpp#L84
   */
  dark: AugmentedModule['datasets_dark']
/**
   * datasets dark constant (1+1), defined by OpenCV for cv::datasets.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/datasets/include/opencv2/datasets/gr_skig.hpp#L84
   */
  DARK: AugmentedModule['datasets_DARK']
/**
   * datasets wooden board constant (1), defined by OpenCV for cv::datasets.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/datasets/include/opencv2/datasets/gr_skig.hpp#L89
   */
  woodenBoard: AugmentedModule['datasets_woodenBoard']
/**
   * datasets wooden board constant (1), defined by OpenCV for cv::datasets.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/datasets/include/opencv2/datasets/gr_skig.hpp#L89
   */
  WOODEN_BOARD: AugmentedModule['datasets_WOODEN_BOARD']
/**
   * datasets white paper constant (1+1), defined by OpenCV for cv::datasets.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/datasets/include/opencv2/datasets/gr_skig.hpp#L90
   */
  whitePaper: AugmentedModule['datasets_whitePaper']
/**
   * datasets white paper constant (1+1), defined by OpenCV for cv::datasets.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/datasets/include/opencv2/datasets/gr_skig.hpp#L90
   */
  WHITE_PAPER: AugmentedModule['datasets_WHITE_PAPER']
/**
   * datasets paper with characters constant (1+2), defined by OpenCV for cv::datasets.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/datasets/include/opencv2/datasets/gr_skig.hpp#L91
   */
  paperWithCharacters: AugmentedModule['datasets_paperWithCharacters']
/**
   * datasets paper with characters constant (1+2), defined by OpenCV for cv::datasets.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/datasets/include/opencv2/datasets/gr_skig.hpp#L91
   */
  PAPER_WITH_CHARACTERS: AugmentedModule['datasets_PAPER_WITH_CHARACTERS']
/**
   * datasets humaneva 1 constant (1), defined by OpenCV for cv::datasets.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/datasets/include/opencv2/datasets/hpe_humaneva.hpp#L73
   */
  humaneva_1: AugmentedModule['datasets_humaneva_1']
/**
   * datasets humaneva 1 constant (1), defined by OpenCV for cv::datasets.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/datasets/include/opencv2/datasets/hpe_humaneva.hpp#L73
   */
  HUMANEVA_1: AugmentedModule['datasets_HUMANEVA_1']
/**
   * datasets humaneva 2 constant (1+1), defined by OpenCV for cv::datasets.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/datasets/include/opencv2/datasets/hpe_humaneva.hpp#L74
   */
  humaneva_2: AugmentedModule['datasets_humaneva_2']
/**
   * datasets humaneva 2 constant (1+1), defined by OpenCV for cv::datasets.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/datasets/include/opencv2/datasets/hpe_humaneva.hpp#L74
   */
  HUMANEVA_2: AugmentedModule['datasets_HUMANEVA_2']
/**
   * datasets pos constant (0), defined by OpenCV for cv::datasets.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/datasets/include/opencv2/datasets/pd_inria.hpp#L62
   */
  POS: AugmentedModule['datasets_POS']
/**
   * datasets neg constant (1), defined by OpenCV for cv::datasets.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/datasets/include/opencv2/datasets/pd_inria.hpp#L63
   */
  NEG: AugmentedModule['datasets_NEG']
/**
   * datasets left constant (0), defined by OpenCV for cv::datasets.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/datasets/include/opencv2/datasets/slam_tumindoor.hpp#L62
   */
  LEFT: AugmentedModule['datasets_LEFT']
/**
   * datasets right constant (0+1), defined by OpenCV for cv::datasets.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/datasets/include/opencv2/datasets/slam_tumindoor.hpp#L63
   */
  RIGHT: AugmentedModule['datasets_RIGHT']
/**
   * datasets ladybug constant (0+2), defined by OpenCV for cv::datasets.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/datasets/include/opencv2/datasets/slam_tumindoor.hpp#L64
   */
  LADYBUG: AugmentedModule['datasets_LADYBUG']
}
  /** Native detail namespace. */
  detail: CVNamespace<'detail'> & {
/**
   * An owned native vector. Append values with push_back, read them with get, and release the vector with using or delete(). Native object elements returned by get require separate disposal.
   */
  _ImageFeaturesVector: AugmentedModule['detail__ImageFeaturesVector']
/**
   * An owned native vector. Append values with push_back, read them with get, and release the vector with using or delete(). Native object elements returned by get require separate disposal.
   */
  _MatchesInfoVector: AugmentedModule['detail__MatchesInfoVector']
/**
   * An owned native vector. Append values with push_back, read them with get, and release the vector with using or delete(). Native object elements returned by get require separate disposal.
   */
  _CameraParamsVector: AugmentedModule['detail__CameraParamsVector']
/**
   * ATTENTION! This class is used internally in Large KinFu.
   * It has been pushed to publicly available headers for tests only.
   * Source compatibility of this API is not guaranteed in the future.
   * This class provides tools to solve so-called pose graph problem often arisen in SLAM problems
   * The pose graph format, cost function and optimization techniques
   * repeat the ones used in Ceres 3D Pose Graph Optimization:
   * http://ceres-solver.org/nnls_tutorial.html#other-examples, pose_graph_3d.cc bullet
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/ptcloud/include/opencv2/ptcloud/detail/pose_graph.hpp#L26
   */
  PoseGraph: AugmentedModule['detail_PoseGraph']
/**
   * Base class for all blenders.
   *
   * Simple blender which puts one image over another
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/stitching/include/opencv2/stitching/detail/blenders.hpp#L63
   */
  Blender: AugmentedModule['detail_Blender']
/**
   * Simple blender which mixes images at its borders.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/stitching/include/opencv2/stitching/detail/blenders.hpp#L100
   */
  FeatherBlender: AugmentedModule['detail_FeatherBlender']
/**
   * Blender which uses multi-band blending algorithm (see [BA83]).
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/stitching/include/opencv2/stitching/detail/blenders.hpp#L127
   */
  MultiBandBlender: AugmentedModule['detail_MultiBandBlender']
/**
   * Describes camera parameters.
   *
   * **Note:** Translation is assumed to be zero during the whole stitching pipeline. :
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/stitching/include/opencv2/stitching/detail/camera.hpp#L58
   */
  CameraParams: AugmentedModule['detail_CameraParams']
/**
   * Base class for all exposure compensators.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/stitching/include/opencv2/stitching/detail/exposure_compensate.hpp#L61
   */
  ExposureCompensator: AugmentedModule['detail_ExposureCompensator']
/**
   * Stub exposure compensator which does nothing.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/stitching/include/opencv2/stitching/detail/exposure_compensate.hpp#L99
   */
  NoExposureCompensator: AugmentedModule['detail_NoExposureCompensator']
/**
   * Exposure compensator which tries to remove exposure related artifacts by adjusting image
   * intensities, see [BL07] and [WJ10] for details.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/stitching/include/opencv2/stitching/detail/exposure_compensate.hpp#L112
   */
  GainCompensator: AugmentedModule['detail_GainCompensator']
/**
   * Exposure compensator which tries to remove exposure related artifacts by adjusting image
   * intensities on each channel independently.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/stitching/include/opencv2/stitching/detail/exposure_compensate.hpp#L146
   */
  ChannelsCompensator: AugmentedModule['detail_ChannelsCompensator']
/**
   * Exposure compensator which tries to remove exposure related artifacts by adjusting image blocks.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/stitching/include/opencv2/stitching/detail/exposure_compensate.hpp#L170
   */
  BlocksCompensator: AugmentedModule['detail_BlocksCompensator']
/**
   * Exposure compensator which tries to remove exposure related artifacts by adjusting image block
   * intensities, see [UES01] for details.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/stitching/include/opencv2/stitching/detail/exposure_compensate.hpp#L208
   */
  BlocksGainCompensator: AugmentedModule['detail_BlocksGainCompensator']
/**
   * Exposure compensator which tries to remove exposure related artifacts by adjusting image block
   * on each channel.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/stitching/include/opencv2/stitching/detail/exposure_compensate.hpp#L232
   */
  BlocksChannelsCompensator: AugmentedModule['detail_BlocksChannelsCompensator']
/**
   * Structure containing image keypoints and descriptors.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/stitching/include/opencv2/stitching/detail/matchers.hpp#L58
   */
  ImageFeatures: AugmentedModule['detail_ImageFeatures']
/**
   * Structure containing information about matches between two images.
   *
   * It's assumed that there is a transformation between those images. Transformation may be
   * homography or affine transformation based on selected matcher.
   *
   * See: detail::FeaturesMatcher
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/stitching/include/opencv2/stitching/detail/matchers.hpp#L99
   */
  MatchesInfo: AugmentedModule['detail_MatchesInfo']
/**
   * Feature matchers base class.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/stitching/include/opencv2/stitching/detail/matchers.hpp#L117
   */
  FeaturesMatcher: AugmentedModule['detail_FeaturesMatcher']
/**
   * Features matcher which finds two best matches for each feature and leaves the best one only if the
   * ratio between descriptor distances is greater than the threshold match_conf
   *
   * See: detail::FeaturesMatcher
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/stitching/include/opencv2/stitching/detail/matchers.hpp#L182
   */
  BestOf2NearestMatcher: AugmentedModule['detail_BestOf2NearestMatcher']
/**
   * detail best of2 nearest range matcher value in the OpenCV API.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/stitching/include/opencv2/stitching/detail/matchers.hpp#L212
   */
  BestOf2NearestRangeMatcher: AugmentedModule['detail_BestOf2NearestRangeMatcher']
/**
   * Features matcher similar to cv::detail::BestOf2NearestMatcher which
   * finds two best matches for each feature and leaves the best one only if the
   * ratio between descriptor distances is greater than the threshold match_conf.
   *
   * Unlike cv::detail::BestOf2NearestMatcher this matcher uses affine
   * transformation (affine transformation estimate will be placed in matches_info).
   *
   * See: cv::detail::FeaturesMatcher cv::detail::BestOf2NearestMatcher
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/stitching/include/opencv2/stitching/detail/matchers.hpp#L236
   */
  AffineBestOf2NearestMatcher: AugmentedModule['detail_AffineBestOf2NearestMatcher']
/**
   * Features matcher that adapts LightGlueMatcher (DescriptorMatcher) to the
   * stitching pipeline's FeaturesMatcher interface.
   *
   * This matcher uses DNN-based LightGlue for feature matching, requiring ALIKED-style
   * keypoints with spatial context for positional encoding.
   *
   * See: cv::detail::FeaturesMatcher cv::LightGlueMatcher
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/stitching/include/opencv2/stitching/detail/matchers.hpp#L270
   */
  LightGlueFeaturesMatcher: AugmentedModule['detail_LightGlueFeaturesMatcher']
/**
   * Rotation estimator base class.
   *
   * It takes features of all images, pairwise matches between all images and estimates rotations of all
   * cameras.
   *
   * **Note:** The coordinate system origin is implementation-dependent, but you can always normalize the
   * rotations in respect to the first camera, for instance. :
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/stitching/include/opencv2/stitching/detail/motion_estimators.hpp#L65
   */
  Estimator: AugmentedModule['detail_Estimator']
/**
   * Homography based rotation estimator.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/stitching/include/opencv2/stitching/detail/motion_estimators.hpp#L100
   */
  HomographyBasedEstimator: AugmentedModule['detail_HomographyBasedEstimator']
/**
   * Affine transformation based estimator.
   *
   * This estimator uses pairwise transformations estimated by matcher to estimate
   * final transformation for each camera.
   *
   * See: cv::detail::HomographyBasedEstimator
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/stitching/include/opencv2/stitching/detail/motion_estimators.hpp#L121
   */
  AffineBasedEstimator: AugmentedModule['detail_AffineBasedEstimator']
/**
   * Base class for all camera parameters refinement methods.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/stitching/include/opencv2/stitching/detail/motion_estimators.hpp#L133
   */
  BundleAdjusterBase: AugmentedModule['detail_BundleAdjusterBase']
/**
   * Stub bundle adjuster that does nothing.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/stitching/include/opencv2/stitching/detail/motion_estimators.hpp#L221
   */
  NoBundleAdjuster: AugmentedModule['detail_NoBundleAdjuster']
/**
   * Implementation of the camera parameters refinement algorithm which minimizes sum of the reprojection
   * error squares
   *
   * It can estimate focal length, aspect ratio, principal point.
   * You can affect only on them via the refinement mask.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/stitching/include/opencv2/stitching/detail/motion_estimators.hpp#L245
   */
  BundleAdjusterReproj: AugmentedModule['detail_BundleAdjusterReproj']
/**
   * Implementation of the camera parameters refinement algorithm which minimizes sum of the distances
   * between the rays passing through the camera center and a feature. :
   *
   * It can estimate focal length. It ignores the refinement mask for now.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/stitching/include/opencv2/stitching/detail/motion_estimators.hpp#L265
   */
  BundleAdjusterRay: AugmentedModule['detail_BundleAdjusterRay']
/**
   * Bundle adjuster that expects affine transformation
   * represented in homogeneous coordinates in R for each camera param. Implements
   * camera parameters refinement algorithm which minimizes sum of the reprojection
   * error squares
   *
   * It estimates all transformation parameters. Refinement mask is ignored.
   *
   * See: AffineBasedEstimator AffineBestOf2NearestMatcher BundleAdjusterAffinePartial
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/stitching/include/opencv2/stitching/detail/motion_estimators.hpp#L289
   */
  BundleAdjusterAffine: AugmentedModule['detail_BundleAdjusterAffine']
/**
   * Bundle adjuster that expects affine transformation with 4 DOF
   * represented in homogeneous coordinates in R for each camera param. Implements
   * camera parameters refinement algorithm which minimizes sum of the reprojection
   * error squares
   *
   * It estimates all transformation parameters. Refinement mask is ignored.
   *
   * See: AffineBasedEstimator AffineBestOf2NearestMatcher BundleAdjusterAffine
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/stitching/include/opencv2/stitching/detail/motion_estimators.hpp#L313
   */
  BundleAdjusterAffinePartial: AugmentedModule['detail_BundleAdjusterAffinePartial']
/**
   * Base class for a seam estimator.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/stitching/include/opencv2/stitching/detail/seam_finders.hpp#L58
   */
  SeamFinder: AugmentedModule['detail_SeamFinder']
/**
   * Stub seam estimator which does nothing.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/stitching/include/opencv2/stitching/detail/seam_finders.hpp#L76
   */
  NoSeamFinder: AugmentedModule['detail_NoSeamFinder']
/**
   * Base class for all pairwise seam estimators.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/stitching/include/opencv2/stitching/detail/seam_finders.hpp#L84
   */
  PairwiseSeamFinder: AugmentedModule['detail_PairwiseSeamFinder']
/**
   * Voronoi diagram-based seam estimator.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/stitching/include/opencv2/stitching/detail/seam_finders.hpp#L108
   */
  VoronoiSeamFinder: AugmentedModule['detail_VoronoiSeamFinder']
/**
   * detail dp seam finder value in the OpenCV API.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/stitching/include/opencv2/stitching/detail/seam_finders.hpp#L120
   */
  DpSeamFinder: AugmentedModule['detail_DpSeamFinder']
/**
   * Minimum graph cut-based seam estimator. See details in [Kwatra03] .
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/stitching/include/opencv2/stitching/detail/seam_finders.hpp#L240
   */
  GraphCutSeamFinder: AugmentedModule['detail_GraphCutSeamFinder']
/**
   * Base Timelapser class, takes a sequence of images, applies appropriate shift, stores result in dst_.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/stitching/include/opencv2/stitching/detail/timelapsers.hpp#L57
   */
  Timelapser: AugmentedModule['detail_Timelapser']
/**
   * detail timelapser crop value in the OpenCV API.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/stitching/include/opencv2/stitching/detail/timelapsers.hpp#L80
   */
  TimelapserCrop: AugmentedModule['detail_TimelapserCrop']
/**
   * Base class for warping logic implementation.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/stitching/include/opencv2/stitching/detail/warpers.hpp#L133
   */
  ProjectorBase: AugmentedModule['detail_ProjectorBase']
/**
   * Extracts rotation and translation matrices from matrix H representing
   *         affine transformation in homogeneous coordinates
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/stitching/include/opencv2/stitching/detail/warpers.hpp#L294
   */
  SphericalProjector: AugmentedModule['detail_SphericalProjector']
/**
   * Returns string of cv::Mat depth value: CV_8UC3 -> "CV_8UC3" or cv::String()
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/check.hpp#L30
   */
  TestOp: AugmentedModule['detail_TestOp']
/**
   * TrackerSampler based on CSC (current state centered), used by MIL algorithm TrackerMIL
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/video/include/opencv2/video/detail/tracking.detail.hpp#L354
   */
  TrackerSamplerCSC_MODE: AugmentedModule['detail_TrackerSamplerCSC_MODE']
/**
   * This enum is utilized mostly by GArray and GOpaque to store and recognize their internal data
   * types (aka Host type). Also it is widely used during serialization routine.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/gcommon.hpp#L42
   */
  OpaqueKind: AugmentedModule['detail_OpaqueKind']
/**
   * FIXME: These traits and enum and possible numerous switch(kind)
   * block may be replaced with a special Handler<T> object or with
   * a double dispatch
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/gtype_traits.hpp#L44
   */
  ArgKind: AugmentedModule['detail_ArgKind']
/**
   * Native enum entries for detail wave correct kind. Pass an entry to enum-typed arguments or its .value to numeric arguments.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/stitching/include/opencv2/stitching/detail/motion_estimators.hpp#L328
   */
  WaveCorrectKind: AugmentedModule['detail_WaveCorrectKind']
/**
   * Native enum entries for detail dp seam finder cost function. Pass an entry to enum-typed arguments or its .value to numeric arguments.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/stitching/include/opencv2/stitching/detail/seam_finders.hpp#L123
   */
  DpSeamFinder_CostFunction: AugmentedModule['detail_DpSeamFinder_CostFunction']
/**
   * Base class for all minimum graph-cut-based seam estimators.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/stitching/include/opencv2/stitching/detail/seam_finders.hpp#L235
   */
  GraphCutSeamFinderBase_CostType: AugmentedModule['detail_GraphCutSeamFinderBase_CostType']
/**
   * Native enum entries for detail cv feature params feature type. Pass an entry to enum-typed arguments or its .value to numeric arguments.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/tracking/include/opencv2/tracking/feature.hpp#L143
   */
  CvFeatureParams_FeatureType: AugmentedModule['detail_CvFeatureParams_FeatureType']
/**
   * detail test custom constant (0), defined by OpenCV for cv::detail.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/check.hpp#L31
   */
  TEST_CUSTOM: AugmentedModule['detail_TEST_CUSTOM']
/**
   * detail test eq constant (1), defined by OpenCV for cv::detail.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/check.hpp#L32
   */
  TEST_EQ: AugmentedModule['detail_TEST_EQ']
/**
   * detail test ne constant (2), defined by OpenCV for cv::detail.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/check.hpp#L33
   */
  TEST_NE: AugmentedModule['detail_TEST_NE']
/**
   * detail test le constant (3), defined by OpenCV for cv::detail.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/check.hpp#L34
   */
  TEST_LE: AugmentedModule['detail_TEST_LE']
/**
   * detail test lt constant (4), defined by OpenCV for cv::detail.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/check.hpp#L35
   */
  TEST_LT: AugmentedModule['detail_TEST_LT']
/**
   * detail test ge constant (5), defined by OpenCV for cv::detail.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/check.hpp#L36
   */
  TEST_GE: AugmentedModule['detail_TEST_GE']
/**
   * detail test gt constant (6), defined by OpenCV for cv::detail.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/check.hpp#L37
   */
  TEST_GT: AugmentedModule['detail_TEST_GT']
/**
   * mode for init positive samples
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/video/include/opencv2/video/detail/tracking.detail.hpp#L356
   */
  TrackerSamplerCSC_MODE_INIT_POS: AugmentedModule['detail_TrackerSamplerCSC_MODE_INIT_POS']
/**
   * mode for init positive samples
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/video/include/opencv2/video/detail/tracking.detail.hpp#L356
   */
  TRACKER_SAMPLER_CSC_MODE_INIT_POS: AugmentedModule['detail_TRACKER_SAMPLER_CSC_MODE_INIT_POS']
/**
   * mode for init negative samples
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/video/include/opencv2/video/detail/tracking.detail.hpp#L357
   */
  TrackerSamplerCSC_MODE_INIT_NEG: AugmentedModule['detail_TrackerSamplerCSC_MODE_INIT_NEG']
/**
   * mode for init negative samples
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/video/include/opencv2/video/detail/tracking.detail.hpp#L357
   */
  TRACKER_SAMPLER_CSC_MODE_INIT_NEG: AugmentedModule['detail_TRACKER_SAMPLER_CSC_MODE_INIT_NEG']
/**
   * mode for update positive samples
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/video/include/opencv2/video/detail/tracking.detail.hpp#L358
   */
  TrackerSamplerCSC_MODE_TRACK_POS: AugmentedModule['detail_TrackerSamplerCSC_MODE_TRACK_POS']
/**
   * mode for update positive samples
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/video/include/opencv2/video/detail/tracking.detail.hpp#L358
   */
  TRACKER_SAMPLER_CSC_MODE_TRACK_POS: AugmentedModule['detail_TRACKER_SAMPLER_CSC_MODE_TRACK_POS']
/**
   * mode for update negative samples
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/video/include/opencv2/video/detail/tracking.detail.hpp#L359
   */
  TrackerSamplerCSC_MODE_TRACK_NEG: AugmentedModule['detail_TrackerSamplerCSC_MODE_TRACK_NEG']
/**
   * mode for update negative samples
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/video/include/opencv2/video/detail/tracking.detail.hpp#L359
   */
  TRACKER_SAMPLER_CSC_MODE_TRACK_NEG: AugmentedModule['detail_TRACKER_SAMPLER_CSC_MODE_TRACK_NEG']
/**
   * mode for detect samples
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/video/include/opencv2/video/detail/tracking.detail.hpp#L360
   */
  TrackerSamplerCSC_MODE_DETECT: AugmentedModule['detail_TrackerSamplerCSC_MODE_DETECT']
/**
   * mode for detect samples
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/video/include/opencv2/video/detail/tracking.detail.hpp#L360
   */
  TRACKER_SAMPLER_CSC_MODE_DETECT: AugmentedModule['detail_TRACKER_SAMPLER_CSC_MODE_DETECT']
/**
   * Unknown, generic, opaque-to-GAPI data type unsupported in graph seriallization
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/gcommon.hpp#L44
   */
  OpaqueKind_CV_UNKNOWN: AugmentedModule['detail_OpaqueKind_CV_UNKNOWN']
/**
   * Unknown, generic, opaque-to-GAPI data type unsupported in graph seriallization
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/gcommon.hpp#L44
   */
  OPAQUE_KIND_CV_UNKNOWN: AugmentedModule['detail_OPAQUE_KIND_CV_UNKNOWN']
/**
   * bool user G-API data
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/gcommon.hpp#L45
   */
  OpaqueKind_CV_BOOL: AugmentedModule['detail_OpaqueKind_CV_BOOL']
/**
   * bool user G-API data
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/gcommon.hpp#L45
   */
  OPAQUE_KIND_CV_BOOL: AugmentedModule['detail_OPAQUE_KIND_CV_BOOL']
/**
   * int user G-API data
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/gcommon.hpp#L46
   */
  OpaqueKind_CV_INT: AugmentedModule['detail_OpaqueKind_CV_INT']
/**
   * int user G-API data
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/gcommon.hpp#L46
   */
  OPAQUE_KIND_CV_INT: AugmentedModule['detail_OPAQUE_KIND_CV_INT']
/**
   * int64_t user G-API data
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/gcommon.hpp#L47
   */
  OpaqueKind_CV_INT64: AugmentedModule['detail_OpaqueKind_CV_INT64']
/**
   * int64_t user G-API data
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/gcommon.hpp#L47
   */
  OPAQUE_KIND_CV_INT64: AugmentedModule['detail_OPAQUE_KIND_CV_INT64']
/**
   * double user G-API data
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/gcommon.hpp#L48
   */
  OpaqueKind_CV_DOUBLE: AugmentedModule['detail_OpaqueKind_CV_DOUBLE']
/**
   * double user G-API data
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/gcommon.hpp#L48
   */
  OPAQUE_KIND_CV_DOUBLE: AugmentedModule['detail_OPAQUE_KIND_CV_DOUBLE']
/**
   * float user G-API data
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/gcommon.hpp#L49
   */
  OpaqueKind_CV_FLOAT: AugmentedModule['detail_OpaqueKind_CV_FLOAT']
/**
   * float user G-API data
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/gcommon.hpp#L49
   */
  OPAQUE_KIND_CV_FLOAT: AugmentedModule['detail_OPAQUE_KIND_CV_FLOAT']
/**
   * uint64_t user G-API data
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/gcommon.hpp#L50
   */
  OpaqueKind_CV_UINT64: AugmentedModule['detail_OpaqueKind_CV_UINT64']
/**
   * uint64_t user G-API data
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/gcommon.hpp#L50
   */
  OPAQUE_KIND_CV_UINT64: AugmentedModule['detail_OPAQUE_KIND_CV_UINT64']
/**
   * std::string user G-API data
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/gcommon.hpp#L51
   */
  OpaqueKind_CV_STRING: AugmentedModule['detail_OpaqueKind_CV_STRING']
/**
   * std::string user G-API data
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/gcommon.hpp#L51
   */
  OPAQUE_KIND_CV_STRING: AugmentedModule['detail_OPAQUE_KIND_CV_STRING']
/**
   * cv::Point user G-API data
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/gcommon.hpp#L52
   */
  OpaqueKind_CV_POINT: AugmentedModule['detail_OpaqueKind_CV_POINT']
/**
   * cv::Point user G-API data
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/gcommon.hpp#L52
   */
  OPAQUE_KIND_CV_POINT: AugmentedModule['detail_OPAQUE_KIND_CV_POINT']
/**
   * cv::Point2f user G-API data
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/gcommon.hpp#L53
   */
  OpaqueKind_CV_POINT2F: AugmentedModule['detail_OpaqueKind_CV_POINT2F']
/**
   * cv::Point2f user G-API data
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/gcommon.hpp#L53
   */
  OPAQUE_KIND_CV_POINT2F: AugmentedModule['detail_OPAQUE_KIND_CV_POINT2F']
/**
   * cv::Point3f user G-API data
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/gcommon.hpp#L54
   */
  OpaqueKind_CV_POINT3F: AugmentedModule['detail_OpaqueKind_CV_POINT3F']
/**
   * cv::Point3f user G-API data
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/gcommon.hpp#L54
   */
  OPAQUE_KIND_CV_POINT3F: AugmentedModule['detail_OPAQUE_KIND_CV_POINT3F']
/**
   * cv::Size user G-API data
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/gcommon.hpp#L55
   */
  OpaqueKind_CV_SIZE: AugmentedModule['detail_OpaqueKind_CV_SIZE']
/**
   * cv::Size user G-API data
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/gcommon.hpp#L55
   */
  OPAQUE_KIND_CV_SIZE: AugmentedModule['detail_OPAQUE_KIND_CV_SIZE']
/**
   * cv::Rect user G-API data
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/gcommon.hpp#L56
   */
  OpaqueKind_CV_RECT: AugmentedModule['detail_OpaqueKind_CV_RECT']
/**
   * cv::Rect user G-API data
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/gcommon.hpp#L56
   */
  OPAQUE_KIND_CV_RECT: AugmentedModule['detail_OPAQUE_KIND_CV_RECT']
/**
   * cv::Scalar user G-API data
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/gcommon.hpp#L57
   */
  OpaqueKind_CV_SCALAR: AugmentedModule['detail_OpaqueKind_CV_SCALAR']
/**
   * cv::Scalar user G-API data
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/gcommon.hpp#L57
   */
  OPAQUE_KIND_CV_SCALAR: AugmentedModule['detail_OPAQUE_KIND_CV_SCALAR']
/**
   * cv::Mat user G-API data
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/gcommon.hpp#L58
   */
  OpaqueKind_CV_MAT: AugmentedModule['detail_OpaqueKind_CV_MAT']
/**
   * cv::Mat user G-API data
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/gcommon.hpp#L58
   */
  OPAQUE_KIND_CV_MAT: AugmentedModule['detail_OPAQUE_KIND_CV_MAT']
/**
   * cv::gapi::wip::draw::Prim user G-API data
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/gcommon.hpp#L59
   */
  OpaqueKind_CV_DRAW_PRIM: AugmentedModule['detail_OpaqueKind_CV_DRAW_PRIM']
/**
   * cv::gapi::wip::draw::Prim user G-API data
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/gcommon.hpp#L59
   */
  OPAQUE_KIND_CV_DRAW_PRIM: AugmentedModule['detail_OPAQUE_KIND_CV_DRAW_PRIM']
/**
   * deprecated value used for compatibility, use OPAQUE_VAL instead
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/gtype_traits.hpp#L49
   */
  ArgKind_OPAQUE_VAL: AugmentedModule['detail_ArgKind_OPAQUE_VAL']
/**
   * deprecated value used for compatibility, use OPAQUE_VAL instead
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/gtype_traits.hpp#L49
   */
  ARG_KIND_OPAQUE_VAL: AugmentedModule['detail_ARG_KIND_OPAQUE_VAL']
/**
   * deprecated value used for compatibility, use OPAQUE_VAL instead
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/gtype_traits.hpp#L49
   */
  ArgKind_OPAQUE: AugmentedModule['detail_ArgKind_OPAQUE']
/**
   * deprecated value used for compatibility, use OPAQUE_VAL instead
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/gtype_traits.hpp#L49
   */
  ARG_KIND_OPAQUE: AugmentedModule['detail_ARG_KIND_OPAQUE']
/**
   * <internal> reference to object
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/gtype_traits.hpp#L51
   */
  ArgKind_GOBJREF: AugmentedModule['detail_ArgKind_GOBJREF']
/**
   * <internal> reference to object
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/gtype_traits.hpp#L51
   */
  ARG_KIND_GOBJREF: AugmentedModule['detail_ARG_KIND_GOBJREF']
/**
   * detail_ArgKind_GMAT: a cv::GMat
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/gtype_traits.hpp#L52
   */
  ArgKind_GMAT: AugmentedModule['detail_ArgKind_GMAT']
/**
   * detail_ARG_KIND_GMAT: a cv::GMat
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/gtype_traits.hpp#L52
   */
  ARG_KIND_GMAT: AugmentedModule['detail_ARG_KIND_GMAT']
/**
   * detail_ArgKind_GMATP: a cv::GMatP
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/gtype_traits.hpp#L53
   */
  ArgKind_GMATP: AugmentedModule['detail_ArgKind_GMATP']
/**
   * detail_ARG_KIND_GMATP: a cv::GMatP
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/gtype_traits.hpp#L53
   */
  ARG_KIND_GMATP: AugmentedModule['detail_ARG_KIND_GMATP']
/**
   * detail_ArgKind_GFRAME: a cv::GFrame
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/gtype_traits.hpp#L54
   */
  ArgKind_GFRAME: AugmentedModule['detail_ArgKind_GFRAME']
/**
   * detail_ARG_KIND_GFRAME: a cv::GFrame
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/gtype_traits.hpp#L54
   */
  ARG_KIND_GFRAME: AugmentedModule['detail_ARG_KIND_GFRAME']
/**
   * detail_ArgKind_GSCALAR: a cv::GScalar
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/gtype_traits.hpp#L55
   */
  ArgKind_GSCALAR: AugmentedModule['detail_ArgKind_GSCALAR']
/**
   * detail_ARG_KIND_GSCALAR: a cv::GScalar
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/gtype_traits.hpp#L55
   */
  ARG_KIND_GSCALAR: AugmentedModule['detail_ARG_KIND_GSCALAR']
/**
   * a cv::GArrayU  (note - exactly GArrayU,  not GArray<T>!)
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/gtype_traits.hpp#L56
   */
  ArgKind_GARRAY: AugmentedModule['detail_ArgKind_GARRAY']
/**
   * a cv::GArrayU  (note - exactly GArrayU,  not GArray<T>!)
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/gtype_traits.hpp#L56
   */
  ARG_KIND_GARRAY: AugmentedModule['detail_ARG_KIND_GARRAY']
/**
   * a cv::GOpaqueU (note - exactly GOpaqueU, not GOpaque<T>!)
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/gtype_traits.hpp#L57
   */
  ArgKind_GOPAQUE: AugmentedModule['detail_ArgKind_GOPAQUE']
/**
   * a cv::GOpaqueU (note - exactly GOpaqueU, not GOpaque<T>!)
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/gtype_traits.hpp#L57
   */
  ARG_KIND_GOPAQUE: AugmentedModule['detail_ARG_KIND_GOPAQUE']
/**
   * detail blender no constant (0), defined by OpenCV for cv::detail::Blender.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/stitching/include/opencv2/stitching/detail/blenders.hpp#L68
   */
  Blender_NO: AugmentedModule['detail_Blender_NO']
/**
   * detail blender no constant (0), defined by OpenCV for cv::detail::Blender.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/stitching/include/opencv2/stitching/detail/blenders.hpp#L68
   */
  BLENDER_NO: AugmentedModule['detail_BLENDER_NO']
/**
   * detail blender feather constant (1), defined by OpenCV for cv::detail::Blender.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/stitching/include/opencv2/stitching/detail/blenders.hpp#L68
   */
  Blender_FEATHER: AugmentedModule['detail_Blender_FEATHER']
/**
   * detail blender feather constant (1), defined by OpenCV for cv::detail::Blender.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/stitching/include/opencv2/stitching/detail/blenders.hpp#L68
   */
  BLENDER_FEATHER: AugmentedModule['detail_BLENDER_FEATHER']
/**
   * detail blender multi band constant (2), defined by OpenCV for cv::detail::Blender.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/stitching/include/opencv2/stitching/detail/blenders.hpp#L68
   */
  Blender_MULTI_BAND: AugmentedModule['detail_Blender_MULTI_BAND']
/**
   * detail blender multi band constant (2), defined by OpenCV for cv::detail::Blender.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/stitching/include/opencv2/stitching/detail/blenders.hpp#L68
   */
  BLENDER_MULTI_BAND: AugmentedModule['detail_BLENDER_MULTI_BAND']
/**
   * detail exposure compensator no constant (0), defined by OpenCV for cv::detail::ExposureCompensator.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/stitching/include/opencv2/stitching/detail/exposure_compensate.hpp#L67
   */
  ExposureCompensator_NO: AugmentedModule['detail_ExposureCompensator_NO']
/**
   * detail exposure compensator no constant (0), defined by OpenCV for cv::detail::ExposureCompensator.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/stitching/include/opencv2/stitching/detail/exposure_compensate.hpp#L67
   */
  EXPOSURE_COMPENSATOR_NO: AugmentedModule['detail_EXPOSURE_COMPENSATOR_NO']
/**
   * detail exposure compensator gain constant (1), defined by OpenCV for cv::detail::ExposureCompensator.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/stitching/include/opencv2/stitching/detail/exposure_compensate.hpp#L67
   */
  ExposureCompensator_GAIN: AugmentedModule['detail_ExposureCompensator_GAIN']
/**
   * detail exposure compensator gain constant (1), defined by OpenCV for cv::detail::ExposureCompensator.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/stitching/include/opencv2/stitching/detail/exposure_compensate.hpp#L67
   */
  EXPOSURE_COMPENSATOR_GAIN: AugmentedModule['detail_EXPOSURE_COMPENSATOR_GAIN']
/**
   * detail exposure compensator gain blocks constant (2), defined by OpenCV for cv::detail::ExposureCompensator.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/stitching/include/opencv2/stitching/detail/exposure_compensate.hpp#L67
   */
  ExposureCompensator_GAIN_BLOCKS: AugmentedModule['detail_ExposureCompensator_GAIN_BLOCKS']
/**
   * detail exposure compensator gain blocks constant (2), defined by OpenCV for cv::detail::ExposureCompensator.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/stitching/include/opencv2/stitching/detail/exposure_compensate.hpp#L67
   */
  EXPOSURE_COMPENSATOR_GAIN_BLOCKS: AugmentedModule['detail_EXPOSURE_COMPENSATOR_GAIN_BLOCKS']
/**
   * detail exposure compensator channels constant (3), defined by OpenCV for cv::detail::ExposureCompensator.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/stitching/include/opencv2/stitching/detail/exposure_compensate.hpp#L67
   */
  ExposureCompensator_CHANNELS: AugmentedModule['detail_ExposureCompensator_CHANNELS']
/**
   * detail exposure compensator channels constant (3), defined by OpenCV for cv::detail::ExposureCompensator.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/stitching/include/opencv2/stitching/detail/exposure_compensate.hpp#L67
   */
  EXPOSURE_COMPENSATOR_CHANNELS: AugmentedModule['detail_EXPOSURE_COMPENSATOR_CHANNELS']
/**
   * detail exposure compensator channels blocks constant (4), defined by OpenCV for cv::detail::ExposureCompensator.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/stitching/include/opencv2/stitching/detail/exposure_compensate.hpp#L67
   */
  ExposureCompensator_CHANNELS_BLOCKS: AugmentedModule['detail_ExposureCompensator_CHANNELS_BLOCKS']
/**
   * detail exposure compensator channels blocks constant (4), defined by OpenCV for cv::detail::ExposureCompensator.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/stitching/include/opencv2/stitching/detail/exposure_compensate.hpp#L67
   */
  EXPOSURE_COMPENSATOR_CHANNELS_BLOCKS: AugmentedModule['detail_EXPOSURE_COMPENSATOR_CHANNELS_BLOCKS']
/**
   * detail wave correct horiz constant (0), defined by OpenCV for cv::detail.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/stitching/include/opencv2/stitching/detail/motion_estimators.hpp#L330
   */
  WAVE_CORRECT_HORIZ: AugmentedModule['detail_WAVE_CORRECT_HORIZ']
/**
   * detail wave correct vert constant (1), defined by OpenCV for cv::detail.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/stitching/include/opencv2/stitching/detail/motion_estimators.hpp#L331
   */
  WAVE_CORRECT_VERT: AugmentedModule['detail_WAVE_CORRECT_VERT']
/**
   * detail wave correct auto constant (2), defined by OpenCV for cv::detail.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/stitching/include/opencv2/stitching/detail/motion_estimators.hpp#L332
   */
  WAVE_CORRECT_AUTO: AugmentedModule['detail_WAVE_CORRECT_AUTO']
/**
   * detail seam finder no constant (0), defined by OpenCV for cv::detail::SeamFinder.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/stitching/include/opencv2/stitching/detail/seam_finders.hpp#L62
   */
  SeamFinder_NO: AugmentedModule['detail_SeamFinder_NO']
/**
   * detail seam finder no constant (0), defined by OpenCV for cv::detail::SeamFinder.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/stitching/include/opencv2/stitching/detail/seam_finders.hpp#L62
   */
  SEAM_FINDER_NO: AugmentedModule['detail_SEAM_FINDER_NO']
/**
   * detail seam finder voronoi seam constant (1), defined by OpenCV for cv::detail::SeamFinder.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/stitching/include/opencv2/stitching/detail/seam_finders.hpp#L62
   */
  SeamFinder_VORONOI_SEAM: AugmentedModule['detail_SeamFinder_VORONOI_SEAM']
/**
   * detail seam finder voronoi seam constant (1), defined by OpenCV for cv::detail::SeamFinder.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/stitching/include/opencv2/stitching/detail/seam_finders.hpp#L62
   */
  SEAM_FINDER_VORONOI_SEAM: AugmentedModule['detail_SEAM_FINDER_VORONOI_SEAM']
/**
   * detail seam finder dp seam constant (2), defined by OpenCV for cv::detail::SeamFinder.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/stitching/include/opencv2/stitching/detail/seam_finders.hpp#L62
   */
  SeamFinder_DP_SEAM: AugmentedModule['detail_SeamFinder_DP_SEAM']
/**
   * detail seam finder dp seam constant (2), defined by OpenCV for cv::detail::SeamFinder.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/stitching/include/opencv2/stitching/detail/seam_finders.hpp#L62
   */
  SEAM_FINDER_DP_SEAM: AugmentedModule['detail_SEAM_FINDER_DP_SEAM']
/**
   * detail dp seam finder color constant (0), defined by OpenCV for cv::detail::DpSeamFinder.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/stitching/include/opencv2/stitching/detail/seam_finders.hpp#L123
   */
  DpSeamFinder_COLOR: AugmentedModule['detail_DpSeamFinder_COLOR']
/**
   * detail dp seam finder color constant (0), defined by OpenCV for cv::detail::DpSeamFinder.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/stitching/include/opencv2/stitching/detail/seam_finders.hpp#L123
   */
  DP_SEAM_FINDER_COLOR: AugmentedModule['detail_DP_SEAM_FINDER_COLOR']
/**
   * detail dp seam finder color grad constant (1), defined by OpenCV for cv::detail::DpSeamFinder.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/stitching/include/opencv2/stitching/detail/seam_finders.hpp#L123
   */
  DpSeamFinder_COLOR_GRAD: AugmentedModule['detail_DpSeamFinder_COLOR_GRAD']
/**
   * detail dp seam finder color grad constant (1), defined by OpenCV for cv::detail::DpSeamFinder.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/stitching/include/opencv2/stitching/detail/seam_finders.hpp#L123
   */
  DP_SEAM_FINDER_COLOR_GRAD: AugmentedModule['detail_DP_SEAM_FINDER_COLOR_GRAD']
/**
   * detail graph cut seam finder base cost color constant (0), defined by OpenCV for cv::detail::GraphCutSeamFinderBase.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/stitching/include/opencv2/stitching/detail/seam_finders.hpp#L235
   */
  GraphCutSeamFinderBase_COST_COLOR: AugmentedModule['detail_GraphCutSeamFinderBase_COST_COLOR']
/**
   * detail graph cut seam finder base cost color constant (0), defined by OpenCV for cv::detail::GraphCutSeamFinderBase.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/stitching/include/opencv2/stitching/detail/seam_finders.hpp#L235
   */
  GRAPH_CUT_SEAM_FINDER_BASE_COST_COLOR: AugmentedModule['detail_GRAPH_CUT_SEAM_FINDER_BASE_COST_COLOR']
/**
   * detail graph cut seam finder base cost color grad constant (1), defined by OpenCV for cv::detail::GraphCutSeamFinderBase.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/stitching/include/opencv2/stitching/detail/seam_finders.hpp#L235
   */
  GraphCutSeamFinderBase_COST_COLOR_GRAD: AugmentedModule['detail_GraphCutSeamFinderBase_COST_COLOR_GRAD']
/**
   * detail graph cut seam finder base cost color grad constant (1), defined by OpenCV for cv::detail::GraphCutSeamFinderBase.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/stitching/include/opencv2/stitching/detail/seam_finders.hpp#L235
   */
  GRAPH_CUT_SEAM_FINDER_BASE_COST_COLOR_GRAD: AugmentedModule['detail_GRAPH_CUT_SEAM_FINDER_BASE_COST_COLOR_GRAD']
/**
   * detail timelapser as is constant (0), defined by OpenCV for cv::detail::Timelapser.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/stitching/include/opencv2/stitching/detail/timelapsers.hpp#L61
   */
  Timelapser_AS_IS: AugmentedModule['detail_Timelapser_AS_IS']
/**
   * detail timelapser as is constant (0), defined by OpenCV for cv::detail::Timelapser.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/stitching/include/opencv2/stitching/detail/timelapsers.hpp#L61
   */
  TIMELAPSER_AS_IS: AugmentedModule['detail_TIMELAPSER_AS_IS']
/**
   * detail timelapser crop constant (1), defined by OpenCV for cv::detail::Timelapser.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/stitching/include/opencv2/stitching/detail/timelapsers.hpp#L61
   */
  Timelapser_CROP: AugmentedModule['detail_Timelapser_CROP']
/**
   * detail timelapser crop constant (1), defined by OpenCV for cv::detail::Timelapser.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/stitching/include/opencv2/stitching/detail/timelapsers.hpp#L61
   */
  TIMELAPSER_CROP: AugmentedModule['detail_TIMELAPSER_CROP']
/**
   * detail cv feature params haar constant (0), defined by OpenCV for cv::detail::CvFeatureParams.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/tracking/include/opencv2/tracking/feature.hpp#L145
   */
  CvFeatureParams_HAAR: AugmentedModule['detail_CvFeatureParams_HAAR']
/**
   * detail cv feature params haar constant (0), defined by OpenCV for cv::detail::CvFeatureParams.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/tracking/include/opencv2/tracking/feature.hpp#L145
   */
  CV_FEATURE_PARAMS_HAAR: AugmentedModule['detail_CV_FEATURE_PARAMS_HAAR']
/**
   * detail cv feature params lbp constant (1), defined by OpenCV for cv::detail::CvFeatureParams.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/tracking/include/opencv2/tracking/feature.hpp#L146
   */
  CvFeatureParams_LBP: AugmentedModule['detail_CvFeatureParams_LBP']
/**
   * detail cv feature params lbp constant (1), defined by OpenCV for cv::detail::CvFeatureParams.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/tracking/include/opencv2/tracking/feature.hpp#L146
   */
  CV_FEATURE_PARAMS_LBP: AugmentedModule['detail_CV_FEATURE_PARAMS_LBP']
/**
   * detail cv feature params hog constant (2), defined by OpenCV for cv::detail::CvFeatureParams.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/tracking/include/opencv2/tracking/feature.hpp#L147
   */
  CvFeatureParams_HOG: AugmentedModule['detail_CvFeatureParams_HOG']
/**
   * detail cv feature params hog constant (2), defined by OpenCV for cv::detail::CvFeatureParams.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/tracking/include/opencv2/tracking/feature.hpp#L147
   */
  CV_FEATURE_PARAMS_HOG: AugmentedModule['detail_CV_FEATURE_PARAMS_HOG']
/**
   * mode for init positive samples
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/tracking/include/opencv2/tracking/tracking_internals.hpp#L646
   */
  TrackerContribSamplerCSC_MODE_INIT_POS: AugmentedModule['detail_TrackerContribSamplerCSC_MODE_INIT_POS']
/**
   * mode for init positive samples
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/tracking/include/opencv2/tracking/tracking_internals.hpp#L646
   */
  TRACKER_CONTRIB_SAMPLER_CSC_MODE_INIT_POS: AugmentedModule['detail_TRACKER_CONTRIB_SAMPLER_CSC_MODE_INIT_POS']
/**
   * mode for init negative samples
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/tracking/include/opencv2/tracking/tracking_internals.hpp#L647
   */
  TrackerContribSamplerCSC_MODE_INIT_NEG: AugmentedModule['detail_TrackerContribSamplerCSC_MODE_INIT_NEG']
/**
   * mode for init negative samples
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/tracking/include/opencv2/tracking/tracking_internals.hpp#L647
   */
  TRACKER_CONTRIB_SAMPLER_CSC_MODE_INIT_NEG: AugmentedModule['detail_TRACKER_CONTRIB_SAMPLER_CSC_MODE_INIT_NEG']
/**
   * mode for update positive samples
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/tracking/include/opencv2/tracking/tracking_internals.hpp#L648
   */
  TrackerContribSamplerCSC_MODE_TRACK_POS: AugmentedModule['detail_TrackerContribSamplerCSC_MODE_TRACK_POS']
/**
   * mode for update positive samples
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/tracking/include/opencv2/tracking/tracking_internals.hpp#L648
   */
  TRACKER_CONTRIB_SAMPLER_CSC_MODE_TRACK_POS: AugmentedModule['detail_TRACKER_CONTRIB_SAMPLER_CSC_MODE_TRACK_POS']
/**
   * mode for update negative samples
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/tracking/include/opencv2/tracking/tracking_internals.hpp#L649
   */
  TrackerContribSamplerCSC_MODE_TRACK_NEG: AugmentedModule['detail_TrackerContribSamplerCSC_MODE_TRACK_NEG']
/**
   * mode for update negative samples
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/tracking/include/opencv2/tracking/tracking_internals.hpp#L649
   */
  TRACKER_CONTRIB_SAMPLER_CSC_MODE_TRACK_NEG: AugmentedModule['detail_TRACKER_CONTRIB_SAMPLER_CSC_MODE_TRACK_NEG']
/**
   * mode for detect samples
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/tracking/include/opencv2/tracking/tracking_internals.hpp#L650
   */
  TrackerContribSamplerCSC_MODE_DETECT: AugmentedModule['detail_TrackerContribSamplerCSC_MODE_DETECT']
/**
   * mode for detect samples
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/tracking/include/opencv2/tracking/tracking_internals.hpp#L650
   */
  TRACKER_CONTRIB_SAMPLER_CSC_MODE_DETECT: AugmentedModule['detail_TRACKER_CONTRIB_SAMPLER_CSC_MODE_DETECT']
/**
   * mode for positive samples
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/tracking/include/opencv2/tracking/tracking_internals.hpp#L705
   */
  TrackerSamplerCS_MODE_POSITIVE: AugmentedModule['detail_TrackerSamplerCS_MODE_POSITIVE']
/**
   * mode for positive samples
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/tracking/include/opencv2/tracking/tracking_internals.hpp#L705
   */
  TRACKER_SAMPLER_CS_MODE_POSITIVE: AugmentedModule['detail_TRACKER_SAMPLER_CS_MODE_POSITIVE']
/**
   * mode for negative samples
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/tracking/include/opencv2/tracking/tracking_internals.hpp#L706
   */
  TrackerSamplerCS_MODE_NEGATIVE: AugmentedModule['detail_TrackerSamplerCS_MODE_NEGATIVE']
/**
   * mode for negative samples
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/tracking/include/opencv2/tracking/tracking_internals.hpp#L706
   */
  TRACKER_SAMPLER_CS_MODE_NEGATIVE: AugmentedModule['detail_TRACKER_SAMPLER_CS_MODE_NEGATIVE']
/**
   * mode for classify samples
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/tracking/include/opencv2/tracking/tracking_internals.hpp#L707
   */
  TrackerSamplerCS_MODE_CLASSIFY: AugmentedModule['detail_TrackerSamplerCS_MODE_CLASSIFY']
/**
   * mode for classify samples
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/tracking/include/opencv2/tracking/tracking_internals.hpp#L707
   */
  TRACKER_SAMPLER_CS_MODE_CLASSIFY: AugmentedModule['detail_TRACKER_SAMPLER_CS_MODE_CLASSIFY']
}
  /** Native dnn namespace. */
  dnn: CVNamespace<'dnn'> & {
/**
   * A DNN layer's instance name, type, learned blobs and named configuration values.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/dnn.hpp#L153
   */
  LayerParams: AugmentedModule['dnn_LayerParams']
/**
   * An owned native vector. Append values with push_back, read them with get, and release the vector with using or delete(). Native object elements returned by get require separate disposal.
   */
  _TargetVector: AugmentedModule['dnn__TargetVector']
/**
   * This struct stores the scalar value (or array) of one of the following type: double, cv::String or int64.
   *  todo: Maybe int64 is useless because double type exactly stores at least 2^52 integers.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/dict.hpp#L60
   */
  DictValue: AugmentedModule['dnn_DictValue']
/**
   * This interface class allows to build new Layers - are building blocks of networks.
   *
   * Each class, derived from Layer, must implement forward() method to compute outputs.
   * Also before using the new layer into networks you must register your layer by using one of `dnnLayerFactory` "LayerFactory" macros.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/dnn.hpp#L270
   */
  Layer: AugmentedModule['dnn_Layer']
/**
   * This class allows to create and manipulate comprehensive artificial neural networks.
   *
   * Neural network is presented as directed acyclic graph (DAG), where vertices are Layer instances,
   * and edges specify relationships between layers inputs and outputs.
   *
   * Each network layer has unique integer id and unique string name inside its network.
   * LayerId can store either layer name or layer id.
   *
   * This class supports reference counting of its instances, i. e. copies point to the same instance.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/dnn.hpp#L557
   */
  Net: AugmentedModule['dnn_Net']
/**
   * Processing params of image to blob.
   *
   * It includes all possible image processing operations and corresponding parameters.
   *
   * See: blobFromImageWithParams
   *
   * **Note:** The order and usage of `scalefactor` and `mean` are (input - mean) * scalefactor.
   * The order and usage of `scalefactor`, `size`, `mean`, `swapRB`, and `ddepth` are consistent
   * with the function of `blobFromImage.`
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/dnn.hpp#L1361
   */
  Image2BlobParams: AugmentedModule['dnn_Image2BlobParams']
/**
   * This class is presented high-level API for neural networks.
   *
   * Model allows to set params for preprocessing input image.
   * Model creates net from file with trained weights and config,
   * sets preprocessing input and runs forward pass.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/dnn.hpp#L1524
   */
  Model: AugmentedModule['dnn_Model']
/**
   * This class represents high-level API for classification models.
   *
   * ClassificationModel allows to set params for preprocessing input image.
   * ClassificationModel creates net from file with trained weights and config,
   * sets preprocessing input, runs forward pass and return top-1 prediction.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/dnn.hpp#L1639
   */
  ClassificationModel: AugmentedModule['dnn_ClassificationModel']
/**
   * This class represents high-level API for keypoints models
   *
   * KeypointsModel allows to set params for preprocessing input image.
   * KeypointsModel creates net from file with trained weights and config,
   * sets preprocessing input, runs forward pass and returns the x and y coordinates of each detected keypoint
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/dnn.hpp#L1692
   */
  KeypointsModel: AugmentedModule['dnn_KeypointsModel']
/**
   * This class represents high-level API for segmentation  models
   *
   * SegmentationModel allows to set params for preprocessing input image.
   * SegmentationModel creates net from file with trained weights and config,
   * sets preprocessing input, runs forward pass and returns the class prediction for each pixel.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/dnn.hpp#L1724
   */
  SegmentationModel: AugmentedModule['dnn_SegmentationModel']
/**
   * This class represents high-level API for object detection networks.
   *
   * DetectionModel allows to set params for preprocessing input image.
   * DetectionModel creates net from file with trained weights and config,
   * sets preprocessing input, runs forward pass and return result detections.
   * For DetectionModel SSD, Faster R-CNN, YOLO topologies are supported.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/dnn.hpp#L1755
   */
  DetectionModel: AugmentedModule['dnn_DetectionModel']
/**
   * This class represents high-level API for text recognition networks.
   *
   * TextRecognitionModel allows to set params for preprocessing input image.
   * TextRecognitionModel creates net from file with trained weights and config,
   * sets preprocessing input, runs forward pass and return recognition result.
   * For TextRecognitionModel, CRNN-CTC is supported.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/dnn.hpp#L1810
   */
  TextRecognitionModel: AugmentedModule['dnn_TextRecognitionModel']
/**
   * Base class for text detection networks
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/dnn.hpp#L1893
   */
  TextDetectionModel: AugmentedModule['dnn_TextDetectionModel']
/**
   * This class represents high-level API for text detection DL networks compatible with EAST model.
   *
   * Configurable parameters:
   * - (float) confThreshold - used to filter boxes by confidences, default: 0.5f
   * - (float) nmsThreshold - used in non maximum suppression, default: 0.0f
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/dnn.hpp#L1966
   */
  TextDetectionModel_EAST: AugmentedModule['dnn_TextDetectionModel_EAST']
/**
   * This class represents high-level API for text detection DL networks compatible with DB model.
   *
   * Related publications: [liao2020real]
   * Paper: https://arxiv.org/abs/1911.08947
   * For more information about the hyper-parameters setting, please refer to https://github.com/MhLiao/DB
   *
   * Configurable parameters:
   * - (float) binaryThreshold - The threshold of the binary map. It is usually set to 0.3.
   * - (float) polygonThreshold - The threshold of text polygons. It is usually set to 0.5, 0.6, and 0.7. Default is 0.5f
   * - (double) unclipRatio - The unclip ratio of the detected text region, which determines the output size. It is usually set to 2.0.
   * - (int) maxCandidates - The max number of the output results.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/dnn.hpp#L2027
   */
  TextDetectionModel_DB: AugmentedModule['dnn_TextDetectionModel_DB']
/**
   * High-level tokenizer wrapper for DNN usage.
   *
   * Provides a simple API to encode and decode tokens for LLMs.
   * Models are loaded via Tokenizer::load().
   *
   * ```cpp
   * using namespace cv::dnn;
   * Tokenizer tok = Tokenizer::load("/path/to/model/");
   * std::vector<int> ids = tok.encode("hello world");
   * std::string text = tok.decode(ids);
   *
   * ```
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/dnn.hpp#L2076
   */
  Tokenizer: AugmentedModule['dnn_Tokenizer']
/**
   * A class to upscale images via convolutional neural networks.
   * The following four models are implemented:
   *
   * - edsr
   * - espcn
   * - fsrcnn
   * - lapsrn
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/dnn_superres/include/opencv2/dnn_superres.hpp#L40
   */
  superres_DnnSuperResImpl: AugmentedModule['dnn_superres_DnnSuperResImpl']
/**
   * GatherND layer
   *
   * GatherND takes two inputs data and indices of rank r >= 1 and q >= 1 respectively,
   * and an optional attribute batch_dims. It gathers slices from data into an output tensor.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/all_layers.hpp#L360
   */
  AutoPadding: AugmentedModule['dnn_AutoPadding']
/**
   * GatherElements layer
   * GatherElements takes two inputs data and indices of the same rank r >= 1 and an optional attribute axis and works such that:
   *   output[i][j][k] = data[index[i][j][k]][j][k] if axis = 0 and r = 3
   *   output[i][j][k] = data[i][index[i][j][k]][k] if axis = 1 and r = 3
   *   output[i][j][k] = data[i][j][index[i][j][k]] if axis = 2 and r = 3
   *
   * Gather, on the other hand, takes a data tensor of rank r >= 1, and indices tensor of rank q, and works such that:
   *   it gathers the enteries along axis dimension of the input data indexed by indices and concatenates them in an output tensor of rank q + (r - 1)
   *   e.g. If axis = 0, let k = indices[i_{0}, ..., i_{q-1}] then output[i_{0}, ..., i_{q-1}, j_{0}, ..., j_{r-2}] = input[k , j_{0}, ..., j_{r-2}]:
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/all_layers.hpp#L595
   */
  Reduce2Layer_ReduceType: AugmentedModule['dnn_Reduce2Layer_ReduceType']
/**
   * Activation type enumeration for dispatched activation function retrieval.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/all_layers.hpp#L1012
   */
  ActivationType: AugmentedModule['dnn_ActivationType']
/**
   * Element wise operation on inputs
   *
   *     Extra optional parameters:
   *     - "operation" as string. Values are "sum" (default), "prod", "max", "div", "min"
   *     - "coeff" as float array. Specify weights of inputs for SUM operation
   *     - "output_channels_mode" as string. Values are "same" (default, all input must have the same layout), "input_0", "input_0_truncate", "max_input_channels"
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/all_layers.hpp#L1410
   */
  NaryEltwiseLayer_OPERATION: AugmentedModule['dnn_NaryEltwiseLayer_OPERATION']
/**
   * Shared reduction enum for DNN loss layers
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/all_layers.hpp#L1679
   */
  LossReduction: AugmentedModule['dnn_LossReduction']
/**
   * Enum of computation backends supported by layers.
   * See: Net::setPreferableBackend
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/dnn.hpp#L71
   */
  Backend: AugmentedModule['dnn_Backend']
/**
   * Enum of target devices for computations.
   * See: Net::setPreferableTarget
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/dnn.hpp#L95
   */
  Target: AugmentedModule['dnn_Target']
/**
   * Native enum entries for dnn tracing mode. Pass an entry to enum-typed arguments or its .value to numeric arguments.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/dnn.hpp#L110
   */
  TracingMode: AugmentedModule['dnn_TracingMode']
/**
   * Native enum entries for dnn profiling mode. Pass an entry to enum-typed arguments or its .value to numeric arguments.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/dnn.hpp#L117
   */
  ProfilingMode: AugmentedModule['dnn_ProfilingMode']
/**
   * Native enum entries for dnn model format. Pass an entry to enum-typed arguments or its .value to numeric arguments.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/dnn.hpp#L124
   */
  ModelFormat: AugmentedModule['dnn_ModelFormat']
/**
   * Indicate that an actual data is on CPU.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/dnn.hpp#L241
   */
  ArgKind: AugmentedModule['dnn_ArgKind']
/**
   * Native enum entries for dnn engine type. Pass an entry to enum-typed arguments or its .value to numeric arguments.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/dnn.hpp#L1084
   */
  EngineType: AugmentedModule['dnn_EngineType']
/**
   * Enum of image processing mode.
   * To facilitate the specialization pre-processing requirements of the dnn model.
   * For example, the `letter box` often used in the Yolo series of models.
   * See: Image2BlobParams
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/dnn.hpp#L1343
   */
  ImagePaddingMode: AugmentedModule['dnn_ImagePaddingMode']
/**
   * Enum of Soft NMS methods.
   * See: softNMSBoxes
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/dnn.hpp#L1488
   */
  SoftNMSMethod: AugmentedModule['dnn_SoftNMSMethod']
/**
   * dnn auto pad none constant (0), defined by OpenCV for cv::dnn.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/all_layers.hpp#L362
   */
  AUTO_PAD_NONE: AugmentedModule['dnn_AUTO_PAD_NONE']
/**
   * dnn auto pad same upper constant (1), defined by OpenCV for cv::dnn.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/all_layers.hpp#L363
   */
  AUTO_PAD_SAME_UPPER: AugmentedModule['dnn_AUTO_PAD_SAME_UPPER']
/**
   * dnn auto pad same lower constant (2), defined by OpenCV for cv::dnn.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/all_layers.hpp#L364
   */
  AUTO_PAD_SAME_LOWER: AugmentedModule['dnn_AUTO_PAD_SAME_LOWER']
/**
   * dnn auto pad valid constant (3), defined by OpenCV for cv::dnn.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/all_layers.hpp#L365
   */
  AUTO_PAD_VALID: AugmentedModule['dnn_AUTO_PAD_VALID']
/**
   * dnn reduce2 layer reduce type max constant (0), defined by OpenCV for cv::dnn::Reduce2Layer::ReduceType.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/all_layers.hpp#L597
   */
  Reduce2Layer_ReduceType_MAX: AugmentedModule['dnn_Reduce2Layer_ReduceType_MAX']
/**
   * dnn reduce2 layer reduce type max constant (0), defined by OpenCV for cv::dnn::Reduce2Layer::ReduceType.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/all_layers.hpp#L597
   */
  REDUCE2LAYER_REDUCE_TYPE_MAX: AugmentedModule['dnn_REDUCE2LAYER_REDUCE_TYPE_MAX']
/**
   * dnn reduce2 layer reduce type min constant (1), defined by OpenCV for cv::dnn::Reduce2Layer::ReduceType.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/all_layers.hpp#L598
   */
  Reduce2Layer_ReduceType_MIN: AugmentedModule['dnn_Reduce2Layer_ReduceType_MIN']
/**
   * dnn reduce2 layer reduce type min constant (1), defined by OpenCV for cv::dnn::Reduce2Layer::ReduceType.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/all_layers.hpp#L598
   */
  REDUCE2LAYER_REDUCE_TYPE_MIN: AugmentedModule['dnn_REDUCE2LAYER_REDUCE_TYPE_MIN']
/**
   * dnn reduce2 layer reduce type mean constant (2), defined by OpenCV for cv::dnn::Reduce2Layer::ReduceType.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/all_layers.hpp#L599
   */
  Reduce2Layer_ReduceType_MEAN: AugmentedModule['dnn_Reduce2Layer_ReduceType_MEAN']
/**
   * dnn reduce2 layer reduce type mean constant (2), defined by OpenCV for cv::dnn::Reduce2Layer::ReduceType.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/all_layers.hpp#L599
   */
  REDUCE2LAYER_REDUCE_TYPE_MEAN: AugmentedModule['dnn_REDUCE2LAYER_REDUCE_TYPE_MEAN']
/**
   * dnn reduce2 layer reduce type sum constant (3), defined by OpenCV for cv::dnn::Reduce2Layer::ReduceType.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/all_layers.hpp#L600
   */
  Reduce2Layer_ReduceType_SUM: AugmentedModule['dnn_Reduce2Layer_ReduceType_SUM']
/**
   * dnn reduce2 layer reduce type sum constant (3), defined by OpenCV for cv::dnn::Reduce2Layer::ReduceType.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/all_layers.hpp#L600
   */
  REDUCE2LAYER_REDUCE_TYPE_SUM: AugmentedModule['dnn_REDUCE2LAYER_REDUCE_TYPE_SUM']
/**
   * dnn reduce2 layer reduce type l1 constant (4), defined by OpenCV for cv::dnn::Reduce2Layer::ReduceType.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/all_layers.hpp#L601
   */
  Reduce2Layer_ReduceType_L1: AugmentedModule['dnn_Reduce2Layer_ReduceType_L1']
/**
   * dnn reduce2 layer reduce type l1 constant (4), defined by OpenCV for cv::dnn::Reduce2Layer::ReduceType.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/all_layers.hpp#L601
   */
  REDUCE2LAYER_REDUCE_TYPE_L1: AugmentedModule['dnn_REDUCE2LAYER_REDUCE_TYPE_L1']
/**
   * dnn reduce2 layer reduce type l2 constant (5), defined by OpenCV for cv::dnn::Reduce2Layer::ReduceType.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/all_layers.hpp#L602
   */
  Reduce2Layer_ReduceType_L2: AugmentedModule['dnn_Reduce2Layer_ReduceType_L2']
/**
   * dnn reduce2 layer reduce type l2 constant (5), defined by OpenCV for cv::dnn::Reduce2Layer::ReduceType.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/all_layers.hpp#L602
   */
  REDUCE2LAYER_REDUCE_TYPE_L2: AugmentedModule['dnn_REDUCE2LAYER_REDUCE_TYPE_L2']
/**
   * dnn reduce2 layer reduce type prod constant (6), defined by OpenCV for cv::dnn::Reduce2Layer::ReduceType.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/all_layers.hpp#L603
   */
  Reduce2Layer_ReduceType_PROD: AugmentedModule['dnn_Reduce2Layer_ReduceType_PROD']
/**
   * dnn reduce2 layer reduce type prod constant (6), defined by OpenCV for cv::dnn::Reduce2Layer::ReduceType.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/all_layers.hpp#L603
   */
  REDUCE2LAYER_REDUCE_TYPE_PROD: AugmentedModule['dnn_REDUCE2LAYER_REDUCE_TYPE_PROD']
/**
   * dnn reduce2 layer reduce type sum square constant (7), defined by OpenCV for cv::dnn::Reduce2Layer::ReduceType.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/all_layers.hpp#L604
   */
  Reduce2Layer_ReduceType_SUM_SQUARE: AugmentedModule['dnn_Reduce2Layer_ReduceType_SUM_SQUARE']
/**
   * dnn reduce2 layer reduce type sum square constant (7), defined by OpenCV for cv::dnn::Reduce2Layer::ReduceType.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/all_layers.hpp#L604
   */
  REDUCE2LAYER_REDUCE_TYPE_SUM_SQUARE: AugmentedModule['dnn_REDUCE2LAYER_REDUCE_TYPE_SUM_SQUARE']
/**
   * dnn reduce2 layer reduce type log sum constant (8), defined by OpenCV for cv::dnn::Reduce2Layer::ReduceType.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/all_layers.hpp#L605
   */
  Reduce2Layer_ReduceType_LOG_SUM: AugmentedModule['dnn_Reduce2Layer_ReduceType_LOG_SUM']
/**
   * dnn reduce2 layer reduce type log sum constant (8), defined by OpenCV for cv::dnn::Reduce2Layer::ReduceType.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/all_layers.hpp#L605
   */
  REDUCE2LAYER_REDUCE_TYPE_LOG_SUM: AugmentedModule['dnn_REDUCE2LAYER_REDUCE_TYPE_LOG_SUM']
/**
   * dnn reduce2 layer reduce type log sum exp constant (9), defined by OpenCV for cv::dnn::Reduce2Layer::ReduceType.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/all_layers.hpp#L606
   */
  Reduce2Layer_ReduceType_LOG_SUM_EXP: AugmentedModule['dnn_Reduce2Layer_ReduceType_LOG_SUM_EXP']
/**
   * dnn reduce2 layer reduce type log sum exp constant (9), defined by OpenCV for cv::dnn::Reduce2Layer::ReduceType.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/all_layers.hpp#L606
   */
  REDUCE2LAYER_REDUCE_TYPE_LOG_SUM_EXP: AugmentedModule['dnn_REDUCE2LAYER_REDUCE_TYPE_LOG_SUM_EXP']
/**
   * dnn activ none constant (0), defined by OpenCV for cv::dnn.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/all_layers.hpp#L1013
   */
  ACTIV_NONE: AugmentedModule['dnn_ACTIV_NONE']
/**
   * dnn activ mish constant (0+1), defined by OpenCV for cv::dnn.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/all_layers.hpp#L1014
   */
  ACTIV_MISH: AugmentedModule['dnn_ACTIV_MISH']
/**
   * dnn activ swish constant (0+2), defined by OpenCV for cv::dnn.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/all_layers.hpp#L1015
   */
  ACTIV_SWISH: AugmentedModule['dnn_ACTIV_SWISH']
/**
   * dnn activ sigmoid constant (0+3), defined by OpenCV for cv::dnn.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/all_layers.hpp#L1016
   */
  ACTIV_SIGMOID: AugmentedModule['dnn_ACTIV_SIGMOID']
/**
   * dnn activ tanh constant (0+4), defined by OpenCV for cv::dnn.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/all_layers.hpp#L1017
   */
  ACTIV_TANH: AugmentedModule['dnn_ACTIV_TANH']
/**
   * dnn activ elu constant (0+5), defined by OpenCV for cv::dnn.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/all_layers.hpp#L1018
   */
  ACTIV_ELU: AugmentedModule['dnn_ACTIV_ELU']
/**
   * dnn activ hardswish constant (0+6), defined by OpenCV for cv::dnn.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/all_layers.hpp#L1019
   */
  ACTIV_HARDSWISH: AugmentedModule['dnn_ACTIV_HARDSWISH']
/**
   * dnn activ hardsigmoid constant (0+7), defined by OpenCV for cv::dnn.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/all_layers.hpp#L1020
   */
  ACTIV_HARDSIGMOID: AugmentedModule['dnn_ACTIV_HARDSIGMOID']
/**
   * dnn activ gelu constant (0+8), defined by OpenCV for cv::dnn.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/all_layers.hpp#L1021
   */
  ACTIV_GELU: AugmentedModule['dnn_ACTIV_GELU']
/**
   * dnn activ gelu approx constant (0+9), defined by OpenCV for cv::dnn.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/all_layers.hpp#L1022
   */
  ACTIV_GELU_APPROX: AugmentedModule['dnn_ACTIV_GELU_APPROX']
/**
   * dnn activ relu constant (0+10), defined by OpenCV for cv::dnn.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/all_layers.hpp#L1023
   */
  ACTIV_RELU: AugmentedModule['dnn_ACTIV_RELU']
/**
   * dnn activ clip constant (0+11), defined by OpenCV for cv::dnn.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/all_layers.hpp#L1024
   */
  ACTIV_CLIP: AugmentedModule['dnn_ACTIV_CLIP']
/**
   * dnn nary eltwise layer operation and constant (0), defined by OpenCV for cv::dnn::NaryEltwiseLayer::OPERATION.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/all_layers.hpp#L1412
   */
  NaryEltwiseLayer_OPERATION_AND: AugmentedModule['dnn_NaryEltwiseLayer_OPERATION_AND']
/**
   * dnn nary eltwise layer operation and constant (0), defined by OpenCV for cv::dnn::NaryEltwiseLayer::OPERATION.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/all_layers.hpp#L1412
   */
  NARY_ELTWISE_LAYER_OPERATION_AND: AugmentedModule['dnn_NARY_ELTWISE_LAYER_OPERATION_AND']
/**
   * dnn nary eltwise layer operation equal constant (0+1), defined by OpenCV for cv::dnn::NaryEltwiseLayer::OPERATION.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/all_layers.hpp#L1413
   */
  NaryEltwiseLayer_OPERATION_EQUAL: AugmentedModule['dnn_NaryEltwiseLayer_OPERATION_EQUAL']
/**
   * dnn nary eltwise layer operation equal constant (0+1), defined by OpenCV for cv::dnn::NaryEltwiseLayer::OPERATION.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/all_layers.hpp#L1413
   */
  NARY_ELTWISE_LAYER_OPERATION_EQUAL: AugmentedModule['dnn_NARY_ELTWISE_LAYER_OPERATION_EQUAL']
/**
   * dnn nary eltwise layer operation greater constant (0+2), defined by OpenCV for cv::dnn::NaryEltwiseLayer::OPERATION.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/all_layers.hpp#L1414
   */
  NaryEltwiseLayer_OPERATION_GREATER: AugmentedModule['dnn_NaryEltwiseLayer_OPERATION_GREATER']
/**
   * dnn nary eltwise layer operation greater constant (0+2), defined by OpenCV for cv::dnn::NaryEltwiseLayer::OPERATION.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/all_layers.hpp#L1414
   */
  NARY_ELTWISE_LAYER_OPERATION_GREATER: AugmentedModule['dnn_NARY_ELTWISE_LAYER_OPERATION_GREATER']
/**
   * dnn nary eltwise layer operation greater equal constant (0+3), defined by OpenCV for cv::dnn::NaryEltwiseLayer::OPERATION.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/all_layers.hpp#L1415
   */
  NaryEltwiseLayer_OPERATION_GREATER_EQUAL: AugmentedModule['dnn_NaryEltwiseLayer_OPERATION_GREATER_EQUAL']
/**
   * dnn nary eltwise layer operation greater equal constant (0+3), defined by OpenCV for cv::dnn::NaryEltwiseLayer::OPERATION.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/all_layers.hpp#L1415
   */
  NARY_ELTWISE_LAYER_OPERATION_GREATER_EQUAL: AugmentedModule['dnn_NARY_ELTWISE_LAYER_OPERATION_GREATER_EQUAL']
/**
   * dnn nary eltwise layer operation less constant (0+4), defined by OpenCV for cv::dnn::NaryEltwiseLayer::OPERATION.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/all_layers.hpp#L1416
   */
  NaryEltwiseLayer_OPERATION_LESS: AugmentedModule['dnn_NaryEltwiseLayer_OPERATION_LESS']
/**
   * dnn nary eltwise layer operation less constant (0+4), defined by OpenCV for cv::dnn::NaryEltwiseLayer::OPERATION.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/all_layers.hpp#L1416
   */
  NARY_ELTWISE_LAYER_OPERATION_LESS: AugmentedModule['dnn_NARY_ELTWISE_LAYER_OPERATION_LESS']
/**
   * dnn nary eltwise layer operation less equal constant (0+5), defined by OpenCV for cv::dnn::NaryEltwiseLayer::OPERATION.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/all_layers.hpp#L1417
   */
  NaryEltwiseLayer_OPERATION_LESS_EQUAL: AugmentedModule['dnn_NaryEltwiseLayer_OPERATION_LESS_EQUAL']
/**
   * dnn nary eltwise layer operation less equal constant (0+5), defined by OpenCV for cv::dnn::NaryEltwiseLayer::OPERATION.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/all_layers.hpp#L1417
   */
  NARY_ELTWISE_LAYER_OPERATION_LESS_EQUAL: AugmentedModule['dnn_NARY_ELTWISE_LAYER_OPERATION_LESS_EQUAL']
/**
   * dnn nary eltwise layer operation or constant (0+6), defined by OpenCV for cv::dnn::NaryEltwiseLayer::OPERATION.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/all_layers.hpp#L1418
   */
  NaryEltwiseLayer_OPERATION_OR: AugmentedModule['dnn_NaryEltwiseLayer_OPERATION_OR']
/**
   * dnn nary eltwise layer operation or constant (0+6), defined by OpenCV for cv::dnn::NaryEltwiseLayer::OPERATION.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/all_layers.hpp#L1418
   */
  NARY_ELTWISE_LAYER_OPERATION_OR: AugmentedModule['dnn_NARY_ELTWISE_LAYER_OPERATION_OR']
/**
   * dnn nary eltwise layer operation pow constant (0+7), defined by OpenCV for cv::dnn::NaryEltwiseLayer::OPERATION.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/all_layers.hpp#L1419
   */
  NaryEltwiseLayer_OPERATION_POW: AugmentedModule['dnn_NaryEltwiseLayer_OPERATION_POW']
/**
   * dnn nary eltwise layer operation pow constant (0+7), defined by OpenCV for cv::dnn::NaryEltwiseLayer::OPERATION.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/all_layers.hpp#L1419
   */
  NARY_ELTWISE_LAYER_OPERATION_POW: AugmentedModule['dnn_NARY_ELTWISE_LAYER_OPERATION_POW']
/**
   * dnn nary eltwise layer operation xor constant (0+8), defined by OpenCV for cv::dnn::NaryEltwiseLayer::OPERATION.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/all_layers.hpp#L1420
   */
  NaryEltwiseLayer_OPERATION_XOR: AugmentedModule['dnn_NaryEltwiseLayer_OPERATION_XOR']
/**
   * dnn nary eltwise layer operation xor constant (0+8), defined by OpenCV for cv::dnn::NaryEltwiseLayer::OPERATION.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/all_layers.hpp#L1420
   */
  NARY_ELTWISE_LAYER_OPERATION_XOR: AugmentedModule['dnn_NARY_ELTWISE_LAYER_OPERATION_XOR']
/**
   * dnn nary eltwise layer operation bitshift constant (0+9), defined by OpenCV for cv::dnn::NaryEltwiseLayer::OPERATION.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/all_layers.hpp#L1421
   */
  NaryEltwiseLayer_OPERATION_BITSHIFT: AugmentedModule['dnn_NaryEltwiseLayer_OPERATION_BITSHIFT']
/**
   * dnn nary eltwise layer operation bitshift constant (0+9), defined by OpenCV for cv::dnn::NaryEltwiseLayer::OPERATION.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/all_layers.hpp#L1421
   */
  NARY_ELTWISE_LAYER_OPERATION_BITSHIFT: AugmentedModule['dnn_NARY_ELTWISE_LAYER_OPERATION_BITSHIFT']
/**
   * dnn nary eltwise layer operation max constant (0+10), defined by OpenCV for cv::dnn::NaryEltwiseLayer::OPERATION.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/all_layers.hpp#L1422
   */
  NaryEltwiseLayer_OPERATION_MAX: AugmentedModule['dnn_NaryEltwiseLayer_OPERATION_MAX']
/**
   * dnn nary eltwise layer operation max constant (0+10), defined by OpenCV for cv::dnn::NaryEltwiseLayer::OPERATION.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/all_layers.hpp#L1422
   */
  NARY_ELTWISE_LAYER_OPERATION_MAX: AugmentedModule['dnn_NARY_ELTWISE_LAYER_OPERATION_MAX']
/**
   * dnn nary eltwise layer operation mean constant (0+11), defined by OpenCV for cv::dnn::NaryEltwiseLayer::OPERATION.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/all_layers.hpp#L1423
   */
  NaryEltwiseLayer_OPERATION_MEAN: AugmentedModule['dnn_NaryEltwiseLayer_OPERATION_MEAN']
/**
   * dnn nary eltwise layer operation mean constant (0+11), defined by OpenCV for cv::dnn::NaryEltwiseLayer::OPERATION.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/all_layers.hpp#L1423
   */
  NARY_ELTWISE_LAYER_OPERATION_MEAN: AugmentedModule['dnn_NARY_ELTWISE_LAYER_OPERATION_MEAN']
/**
   * dnn nary eltwise layer operation min constant (0+12), defined by OpenCV for cv::dnn::NaryEltwiseLayer::OPERATION.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/all_layers.hpp#L1424
   */
  NaryEltwiseLayer_OPERATION_MIN: AugmentedModule['dnn_NaryEltwiseLayer_OPERATION_MIN']
/**
   * dnn nary eltwise layer operation min constant (0+12), defined by OpenCV for cv::dnn::NaryEltwiseLayer::OPERATION.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/all_layers.hpp#L1424
   */
  NARY_ELTWISE_LAYER_OPERATION_MIN: AugmentedModule['dnn_NARY_ELTWISE_LAYER_OPERATION_MIN']
/**
   * Integer Mod. Reminder's sign = Divisor's sign.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/all_layers.hpp#L1425
   */
  NaryEltwiseLayer_OPERATION_MOD: AugmentedModule['dnn_NaryEltwiseLayer_OPERATION_MOD']
/**
   * Integer Mod. Reminder's sign = Divisor's sign.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/all_layers.hpp#L1425
   */
  NARY_ELTWISE_LAYER_OPERATION_MOD: AugmentedModule['dnn_NARY_ELTWISE_LAYER_OPERATION_MOD']
/**
   * Floating-point Mod. Reminder's sign = Dividend's sign.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/all_layers.hpp#L1426
   */
  NaryEltwiseLayer_OPERATION_FMOD: AugmentedModule['dnn_NaryEltwiseLayer_OPERATION_FMOD']
/**
   * Floating-point Mod. Reminder's sign = Dividend's sign.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/all_layers.hpp#L1426
   */
  NARY_ELTWISE_LAYER_OPERATION_FMOD: AugmentedModule['dnn_NARY_ELTWISE_LAYER_OPERATION_FMOD']
/**
   * Floating-point Mod. Reminder's sign = Dividend's sign.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/all_layers.hpp#L1427
   */
  NaryEltwiseLayer_OPERATION_PROD: AugmentedModule['dnn_NaryEltwiseLayer_OPERATION_PROD']
/**
   * Floating-point Mod. Reminder's sign = Dividend's sign.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/all_layers.hpp#L1427
   */
  NARY_ELTWISE_LAYER_OPERATION_PROD: AugmentedModule['dnn_NARY_ELTWISE_LAYER_OPERATION_PROD']
/**
   * dnn nary eltwise layer operation sub constant (0+16), defined by OpenCV for cv::dnn::NaryEltwiseLayer::OPERATION.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/all_layers.hpp#L1428
   */
  NaryEltwiseLayer_OPERATION_SUB: AugmentedModule['dnn_NaryEltwiseLayer_OPERATION_SUB']
/**
   * dnn nary eltwise layer operation sub constant (0+16), defined by OpenCV for cv::dnn::NaryEltwiseLayer::OPERATION.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/all_layers.hpp#L1428
   */
  NARY_ELTWISE_LAYER_OPERATION_SUB: AugmentedModule['dnn_NARY_ELTWISE_LAYER_OPERATION_SUB']
/**
   * dnn nary eltwise layer operation sum constant (0+17), defined by OpenCV for cv::dnn::NaryEltwiseLayer::OPERATION.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/all_layers.hpp#L1429
   */
  NaryEltwiseLayer_OPERATION_SUM: AugmentedModule['dnn_NaryEltwiseLayer_OPERATION_SUM']
/**
   * dnn nary eltwise layer operation sum constant (0+17), defined by OpenCV for cv::dnn::NaryEltwiseLayer::OPERATION.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/all_layers.hpp#L1429
   */
  NARY_ELTWISE_LAYER_OPERATION_SUM: AugmentedModule['dnn_NARY_ELTWISE_LAYER_OPERATION_SUM']
/**
   * dnn nary eltwise layer operation add constant (0+18), defined by OpenCV for cv::dnn::NaryEltwiseLayer::OPERATION.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/all_layers.hpp#L1430
   */
  NaryEltwiseLayer_OPERATION_ADD: AugmentedModule['dnn_NaryEltwiseLayer_OPERATION_ADD']
/**
   * dnn nary eltwise layer operation add constant (0+18), defined by OpenCV for cv::dnn::NaryEltwiseLayer::OPERATION.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/all_layers.hpp#L1430
   */
  NARY_ELTWISE_LAYER_OPERATION_ADD: AugmentedModule['dnn_NARY_ELTWISE_LAYER_OPERATION_ADD']
/**
   * dnn nary eltwise layer operation div constant (0+19), defined by OpenCV for cv::dnn::NaryEltwiseLayer::OPERATION.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/all_layers.hpp#L1431
   */
  NaryEltwiseLayer_OPERATION_DIV: AugmentedModule['dnn_NaryEltwiseLayer_OPERATION_DIV']
/**
   * dnn nary eltwise layer operation div constant (0+19), defined by OpenCV for cv::dnn::NaryEltwiseLayer::OPERATION.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/all_layers.hpp#L1431
   */
  NARY_ELTWISE_LAYER_OPERATION_DIV: AugmentedModule['dnn_NARY_ELTWISE_LAYER_OPERATION_DIV']
/**
   * dnn nary eltwise layer operation where constant (0+20), defined by OpenCV for cv::dnn::NaryEltwiseLayer::OPERATION.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/all_layers.hpp#L1432
   */
  NaryEltwiseLayer_OPERATION_WHERE: AugmentedModule['dnn_NaryEltwiseLayer_OPERATION_WHERE']
/**
   * dnn nary eltwise layer operation where constant (0+20), defined by OpenCV for cv::dnn::NaryEltwiseLayer::OPERATION.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/all_layers.hpp#L1432
   */
  NARY_ELTWISE_LAYER_OPERATION_WHERE: AugmentedModule['dnn_NARY_ELTWISE_LAYER_OPERATION_WHERE']
/**
   * dnn nary eltwise layer operation bitwise and constant (0+21), defined by OpenCV for cv::dnn::NaryEltwiseLayer::OPERATION.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/all_layers.hpp#L1433
   */
  NaryEltwiseLayer_OPERATION_BITWISE_AND: AugmentedModule['dnn_NaryEltwiseLayer_OPERATION_BITWISE_AND']
/**
   * dnn nary eltwise layer operation bitwise and constant (0+21), defined by OpenCV for cv::dnn::NaryEltwiseLayer::OPERATION.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/all_layers.hpp#L1433
   */
  NARY_ELTWISE_LAYER_OPERATION_BITWISE_AND: AugmentedModule['dnn_NARY_ELTWISE_LAYER_OPERATION_BITWISE_AND']
/**
   * dnn nary eltwise layer operation bitwise or constant (0+22), defined by OpenCV for cv::dnn::NaryEltwiseLayer::OPERATION.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/all_layers.hpp#L1434
   */
  NaryEltwiseLayer_OPERATION_BITWISE_OR: AugmentedModule['dnn_NaryEltwiseLayer_OPERATION_BITWISE_OR']
/**
   * dnn nary eltwise layer operation bitwise or constant (0+22), defined by OpenCV for cv::dnn::NaryEltwiseLayer::OPERATION.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/all_layers.hpp#L1434
   */
  NARY_ELTWISE_LAYER_OPERATION_BITWISE_OR: AugmentedModule['dnn_NARY_ELTWISE_LAYER_OPERATION_BITWISE_OR']
/**
   * dnn nary eltwise layer operation bitwise xor constant (0+23), defined by OpenCV for cv::dnn::NaryEltwiseLayer::OPERATION.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/all_layers.hpp#L1435
   */
  NaryEltwiseLayer_OPERATION_BITWISE_XOR: AugmentedModule['dnn_NaryEltwiseLayer_OPERATION_BITWISE_XOR']
/**
   * dnn nary eltwise layer operation bitwise xor constant (0+23), defined by OpenCV for cv::dnn::NaryEltwiseLayer::OPERATION.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/all_layers.hpp#L1435
   */
  NARY_ELTWISE_LAYER_OPERATION_BITWISE_XOR: AugmentedModule['dnn_NARY_ELTWISE_LAYER_OPERATION_BITWISE_XOR']
/**
   * dnn loss reduction none constant (0), defined by OpenCV for cv::dnn.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/all_layers.hpp#L1681
   */
  LOSS_REDUCTION_NONE: AugmentedModule['dnn_LOSS_REDUCTION_NONE']
/**
   * dnn loss reduction mean constant (1), defined by OpenCV for cv::dnn.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/all_layers.hpp#L1682
   */
  LOSS_REDUCTION_MEAN: AugmentedModule['dnn_LOSS_REDUCTION_MEAN']
/**
   * dnn loss reduction sum constant (2), defined by OpenCV for cv::dnn.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/all_layers.hpp#L1683
   */
  LOSS_REDUCTION_SUM: AugmentedModule['dnn_LOSS_REDUCTION_SUM']
/**
   * DNN_BACKEND_DEFAULT equals to OPENCV_DNN_BACKEND_DEFAULT, which can be defined using CMake or a configuration parameter
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/dnn.hpp#L74
   */
  DNN_BACKEND_DEFAULT: AugmentedModule['dnn_DNN_BACKEND_DEFAULT']
/**
   * internal - use DNN_BACKEND_INFERENCE_ENGINE + setInferenceEngineBackendType()
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/dnn.hpp#L86
   */
  DNN_BACKEND_INFERENCE_ENGINE: AugmentedModule['dnn_DNN_BACKEND_INFERENCE_ENGINE']
/**
   * Intel OpenVINO computational backend, supported targets: CPU, OPENCL, OPENCL_FP16, MYRIAD, HDDL, NPU
   *
   * **Note:** Tutorial how to build OpenCV with OpenVINO: `tutorial_dnn_openvino`
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/dnn.hpp#L77
   */
  DNN_BACKEND_OPENCV: AugmentedModule['dnn_DNN_BACKEND_OPENCV']
/**
   * dnn dnn backend vkcom constant (2+2), defined by OpenCV for cv::dnn.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/dnn.hpp#L78
   */
  DNN_BACKEND_VKCOM: AugmentedModule['dnn_DNN_BACKEND_VKCOM']
/**
   * dnn dnn backend cuda constant (2+3), defined by OpenCV for cv::dnn.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/dnn.hpp#L79
   */
  DNN_BACKEND_CUDA: AugmentedModule['dnn_DNN_BACKEND_CUDA']
/**
   * dnn dnn backend webnn constant (2+4), defined by OpenCV for cv::dnn.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/dnn.hpp#L80
   */
  DNN_BACKEND_WEBNN: AugmentedModule['dnn_DNN_BACKEND_WEBNN']
/**
   * dnn dnn backend timvx constant (2+5), defined by OpenCV for cv::dnn.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/dnn.hpp#L81
   */
  DNN_BACKEND_TIMVX: AugmentedModule['dnn_DNN_BACKEND_TIMVX']
/**
   * dnn dnn backend cann constant (2+6), defined by OpenCV for cv::dnn.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/dnn.hpp#L82
   */
  DNN_BACKEND_CANN: AugmentedModule['dnn_DNN_BACKEND_CANN']
/**
   * dnn dnn target cpu constant (0), defined by OpenCV for cv::dnn.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/dnn.hpp#L97
   */
  DNN_TARGET_CPU: AugmentedModule['dnn_DNN_TARGET_CPU']
/**
   * dnn dnn target opencl constant (0+1), defined by OpenCV for cv::dnn.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/dnn.hpp#L98
   */
  DNN_TARGET_OPENCL: AugmentedModule['dnn_DNN_TARGET_OPENCL']
/**
   * dnn dnn target opencl fp16 constant (0+2), defined by OpenCV for cv::dnn.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/dnn.hpp#L99
   */
  DNN_TARGET_OPENCL_FP16: AugmentedModule['dnn_DNN_TARGET_OPENCL_FP16']
/**
   * dnn dnn target myriad constant (0+3), defined by OpenCV for cv::dnn.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/dnn.hpp#L100
   */
  DNN_TARGET_MYRIAD: AugmentedModule['dnn_DNN_TARGET_MYRIAD']
/**
   * dnn dnn target vulkan constant (0+4), defined by OpenCV for cv::dnn.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/dnn.hpp#L101
   */
  DNN_TARGET_VULKAN: AugmentedModule['dnn_DNN_TARGET_VULKAN']
/**
   * FPGA device with CPU fallbacks using Inference Engine's Heterogeneous plugin.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/dnn.hpp#L102
   */
  DNN_TARGET_FPGA: AugmentedModule['dnn_DNN_TARGET_FPGA']
/**
   * FPGA device with CPU fallbacks using Inference Engine's Heterogeneous plugin.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/dnn.hpp#L103
   */
  DNN_TARGET_CUDA: AugmentedModule['dnn_DNN_TARGET_CUDA']
/**
   * dnn dnn target cuda fp16 constant (0+7), defined by OpenCV for cv::dnn.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/dnn.hpp#L104
   */
  DNN_TARGET_CUDA_FP16: AugmentedModule['dnn_DNN_TARGET_CUDA_FP16']
/**
   * dnn dnn target hddl constant (0+8), defined by OpenCV for cv::dnn.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/dnn.hpp#L105
   */
  DNN_TARGET_HDDL: AugmentedModule['dnn_DNN_TARGET_HDDL']
/**
   * dnn dnn target npu constant (0+9), defined by OpenCV for cv::dnn.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/dnn.hpp#L106
   */
  DNN_TARGET_NPU: AugmentedModule['dnn_DNN_TARGET_NPU']
/**
   * Only the ARM platform is supported. Low precision computing, accelerate model inference.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/dnn.hpp#L107
   */
  DNN_TARGET_CPU_FP16: AugmentedModule['dnn_DNN_TARGET_CPU_FP16']
/**
   * Don't trace anything
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/dnn.hpp#L112
   */
  DNN_TRACE_NONE: AugmentedModule['dnn_DNN_TRACE_NONE']
/**
   * Print all executed operations along with the output tensors, more or less compatible with ONNX Runtime
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/dnn.hpp#L113
   */
  DNN_TRACE_ALL: AugmentedModule['dnn_DNN_TRACE_ALL']
/**
   * Print all executed operations. Types and shapes of all inputs and outputs are printed, but the content is not.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/dnn.hpp#L114
   */
  DNN_TRACE_OP: AugmentedModule['dnn_DNN_TRACE_OP']
/**
   * Don't do any profiling
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/dnn.hpp#L119
   */
  DNN_PROFILE_NONE: AugmentedModule['dnn_DNN_PROFILE_NONE']
/**
   * Collect the summary statistics by layer type (e.g. all "Conv2D" or all "Add") and print it in the end, sorted by the execution time (most expensive layers first). Note that it may introduce some overhead and cause slowdown, especially in the case of non-CPU backends.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/dnn.hpp#L120
   */
  DNN_PROFILE_SUMMARY: AugmentedModule['dnn_DNN_PROFILE_SUMMARY']
/**
   * Print execution time of each single layer. Note that it may introduce some overhead and cause slowdown, especially in the case of non-CPU backends.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/dnn.hpp#L121
   */
  DNN_PROFILE_DETAILED: AugmentedModule['dnn_DNN_PROFILE_DETAILED']
/**
   * Some generic model format
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/dnn.hpp#L125
   */
  DNN_MODEL_GENERIC: AugmentedModule['dnn_DNN_MODEL_GENERIC']
/**
   * dnn_DNN_MODEL_ONNX: ONNX model
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/dnn.hpp#L126
   */
  DNN_MODEL_ONNX: AugmentedModule['dnn_DNN_MODEL_ONNX']
/**
   * dnn_DNN_MODEL_TF: TF model
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/dnn.hpp#L127
   */
  DNN_MODEL_TF: AugmentedModule['dnn_DNN_MODEL_TF']
/**
   * dnn_DNN_MODEL_TFLITE: TFLite model
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/dnn.hpp#L128
   */
  DNN_MODEL_TFLITE: AugmentedModule['dnn_DNN_MODEL_TFLITE']
/**
   * valid only for Arg.idx==0. It's "no-arg"
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/dnn.hpp#L242
   */
  DNN_ARG_EMPTY: AugmentedModule['dnn_DNN_ARG_EMPTY']
/**
   * a constant argument.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/dnn.hpp#L243
   */
  DNN_ARG_CONST: AugmentedModule['dnn_DNN_ARG_CONST']
/**
   * input of the whole model. Before Net::forward() or in Net::forward() all inputs must be set
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/dnn.hpp#L244
   */
  DNN_ARG_INPUT: AugmentedModule['dnn_DNN_ARG_INPUT']
/**
   * output of the model.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/dnn.hpp#L245
   */
  DNN_ARG_OUTPUT: AugmentedModule['dnn_DNN_ARG_OUTPUT']
/**
   * intermediate result, a result of some operation and input to some other operation(s).
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/dnn.hpp#L246
   */
  DNN_ARG_TEMP: AugmentedModule['dnn_DNN_ARG_TEMP']
/**
   * not used for now
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/dnn.hpp#L247
   */
  DNN_ARG_PATTERN: AugmentedModule['dnn_DNN_ARG_PATTERN']
/**
   * Force use the old dnn engine similar to 4.x branch
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/dnn.hpp#L1086
   */
  ENGINE_CLASSIC: AugmentedModule['dnn_ENGINE_CLASSIC']
/**
   * Force use the new dnn engine. The engine does not support non CPU back-ends for now.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/dnn.hpp#L1087
   */
  ENGINE_NEW: AugmentedModule['dnn_ENGINE_NEW']
/**
   * Try to use the new engine and then fall back to the classic version.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/dnn.hpp#L1088
   */
  ENGINE_AUTO: AugmentedModule['dnn_ENGINE_AUTO']
/**
   * Try to use ONNX Runtime wrapper (ONNX only, requires build with WITH_ONNXRUNTIME=ON).
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/dnn.hpp#L1089
   */
  ENGINE_ORT: AugmentedModule['dnn_ENGINE_ORT']
/**
   * !< Default. Resize to required input size without extra processing.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/dnn.hpp#L1345
   */
  DNN_PMODE_NULL: AugmentedModule['dnn_DNN_PMODE_NULL']
/**
   * !< Image will be cropped after resize.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/dnn.hpp#L1346
   */
  DNN_PMODE_CROP_CENTER: AugmentedModule['dnn_DNN_PMODE_CROP_CENTER']
/**
   * !< Resize image to the desired size while preserving the aspect ratio of original image.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/dnn.hpp#L1347
   */
  DNN_PMODE_LETTERBOX: AugmentedModule['dnn_DNN_PMODE_LETTERBOX']
/**
   * dnn soft nmsmethod softnms linear constant (1), defined by OpenCV for cv::dnn::SoftNMSMethod.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/dnn.hpp#L1490
   */
  SoftNMSMethod_SOFTNMS_LINEAR: AugmentedModule['dnn_SoftNMSMethod_SOFTNMS_LINEAR']
/**
   * dnn soft nmsmethod softnms linear constant (1), defined by OpenCV for cv::dnn::SoftNMSMethod.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/dnn.hpp#L1490
   */
  SOFT_NMSMETHOD_SOFTNMS_LINEAR: AugmentedModule['dnn_SOFT_NMSMETHOD_SOFTNMS_LINEAR']
/**
   * dnn soft nmsmethod softnms gaussian constant (2), defined by OpenCV for cv::dnn::SoftNMSMethod.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/dnn.hpp#L1491
   */
  SoftNMSMethod_SOFTNMS_GAUSSIAN: AugmentedModule['dnn_SoftNMSMethod_SOFTNMS_GAUSSIAN']
/**
   * dnn soft nmsmethod softnms gaussian constant (2), defined by OpenCV for cv::dnn::SoftNMSMethod.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/dnn/include/opencv2/dnn/dnn.hpp#L1491
   */
  SOFT_NMSMETHOD_SOFTNMS_GAUSSIAN: AugmentedModule['dnn_SOFT_NMSMETHOD_SOFTNMS_GAUSSIAN']
}
  /** Native dnn_superres namespace. */
  dnn_superres: CVNamespace<'dnn_superres'> & {
/**
   * A class to upscale images via convolutional neural networks.
   * The following four models are implemented:
   *
   * - edsr
   * - espcn
   * - fsrcnn
   * - lapsrn
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/dnn_superres/include/opencv2/dnn_superres.hpp#L40
   */
  DnnSuperResImpl: AugmentedModule['dnn_superres_DnnSuperResImpl']
}
  /** Native dpm namespace. */
  dpm: CVNamespace<'dpm'> & {
/**
   * This is a C++ abstract class, it provides external user API to work with DPM.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/dpm/include/opencv2/dpm.hpp#L104
   */
  DPMDetector: AugmentedModule['dpm_DPMDetector']
/**
   * dpm dpmdetector object detection value in the OpenCV API.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/dpm/include/opencv2/dpm.hpp#L108
   */
  DPMDetector_ObjectDetection: AugmentedModule['dpm_DPMDetector_ObjectDetection']
}
  /** Native dynafu namespace. */
  dynafu: CVNamespace<'dynafu'> & {
/**
   * Backwards compatibility for old versions
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/rgbd/include/opencv2/rgbd/dynafu.hpp#L46
   */
  DynaFu: AugmentedModule['dynafu_DynaFu']
}
  /** Native Error namespace. */
  Error: CVNamespace<'Error'> & {
/**
   * Error_Code: error codes
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/exception.hpp#L18
   */
  Code: AugmentedModule['Error_Code']
/**
   * everything is ok
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/exception.hpp#L19
   */
  StsOk: AugmentedModule['Error_StsOk']
/**
   * everything is ok
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/exception.hpp#L19
   */
  STS_OK: AugmentedModule['Error_STS_OK']
/**
   * pseudo error for back trace
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/exception.hpp#L20
   */
  StsBackTrace: AugmentedModule['Error_StsBackTrace']
/**
   * pseudo error for back trace
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/exception.hpp#L20
   */
  STS_BACK_TRACE: AugmentedModule['Error_STS_BACK_TRACE']
/**
   * unknown /unspecified error
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/exception.hpp#L21
   */
  StsError: AugmentedModule['Error_StsError']
/**
   * unknown /unspecified error
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/exception.hpp#L21
   */
  STS_ERROR: AugmentedModule['Error_STS_ERROR']
/**
   * internal error (bad state)
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/exception.hpp#L22
   */
  StsInternal: AugmentedModule['Error_StsInternal']
/**
   * internal error (bad state)
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/exception.hpp#L22
   */
  STS_INTERNAL: AugmentedModule['Error_STS_INTERNAL']
/**
   * insufficient memory
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/exception.hpp#L23
   */
  StsNoMem: AugmentedModule['Error_StsNoMem']
/**
   * insufficient memory
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/exception.hpp#L23
   */
  STS_NO_MEM: AugmentedModule['Error_STS_NO_MEM']
/**
   * function arg/param is bad
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/exception.hpp#L24
   */
  StsBadArg: AugmentedModule['Error_StsBadArg']
/**
   * function arg/param is bad
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/exception.hpp#L24
   */
  STS_BAD_ARG: AugmentedModule['Error_STS_BAD_ARG']
/**
   * unsupported function
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/exception.hpp#L25
   */
  StsBadFunc: AugmentedModule['Error_StsBadFunc']
/**
   * unsupported function
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/exception.hpp#L25
   */
  STS_BAD_FUNC: AugmentedModule['Error_STS_BAD_FUNC']
/**
   * iteration didn't converge
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/exception.hpp#L26
   */
  StsNoConv: AugmentedModule['Error_StsNoConv']
/**
   * iteration didn't converge
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/exception.hpp#L26
   */
  STS_NO_CONV: AugmentedModule['Error_STS_NO_CONV']
/**
   * Error_StsAutoTrace: tracing
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/exception.hpp#L27
   */
  StsAutoTrace: AugmentedModule['Error_StsAutoTrace']
/**
   * Error_STS_AUTO_TRACE: tracing
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/exception.hpp#L27
   */
  STS_AUTO_TRACE: AugmentedModule['Error_STS_AUTO_TRACE']
/**
   * image header is NULL
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/exception.hpp#L28
   */
  HeaderIsNull: AugmentedModule['Error_HeaderIsNull']
/**
   * image header is NULL
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/exception.hpp#L28
   */
  HEADER_IS_NULL: AugmentedModule['Error_HEADER_IS_NULL']
/**
   * image size is invalid
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/exception.hpp#L29
   */
  BadImageSize: AugmentedModule['Error_BadImageSize']
/**
   * image size is invalid
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/exception.hpp#L29
   */
  BAD_IMAGE_SIZE: AugmentedModule['Error_BAD_IMAGE_SIZE']
/**
   * offset is invalid
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/exception.hpp#L30
   */
  BadOffset: AugmentedModule['Error_BadOffset']
/**
   * offset is invalid
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/exception.hpp#L30
   */
  BAD_OFFSET: AugmentedModule['Error_BAD_OFFSET']
/**
   * BadStep=                   -13,  //!< image step is wrong, this may happen for a non-continuous matrix.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/exception.hpp#L31
   */
  BadDataPtr: AugmentedModule['Error_BadDataPtr']
/**
   * BadStep=                   -13,  //!< image step is wrong, this may happen for a non-continuous matrix.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/exception.hpp#L31
   */
  BAD_DATA_PTR: AugmentedModule['Error_BAD_DATA_PTR']
/**
   * image step is wrong, this may happen for a non-continuous matrix.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/exception.hpp#L32
   */
  BadStep: AugmentedModule['Error_BadStep']
/**
   * image step is wrong, this may happen for a non-continuous matrix.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/exception.hpp#L32
   */
  BAD_STEP: AugmentedModule['Error_BAD_STEP']
/**
   * BadNumChannels=            -15,  //!< bad number of channels, for example, some functions accept only single channel matrices.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/exception.hpp#L33
   */
  BadModelOrChSeq: AugmentedModule['Error_BadModelOrChSeq']
/**
   * BadNumChannels=            -15,  //!< bad number of channels, for example, some functions accept only single channel matrices.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/exception.hpp#L33
   */
  BAD_MODEL_OR_CH_SEQ: AugmentedModule['Error_BAD_MODEL_OR_CH_SEQ']
/**
   * bad number of channels, for example, some functions accept only single channel matrices.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/exception.hpp#L34
   */
  BadNumChannels: AugmentedModule['Error_BadNumChannels']
/**
   * bad number of channels, for example, some functions accept only single channel matrices.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/exception.hpp#L34
   */
  BAD_NUM_CHANNELS: AugmentedModule['Error_BAD_NUM_CHANNELS']
/**
   * BadDepth=                  -17,  //!< input image depth is not supported by the function
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/exception.hpp#L35
   */
  BadNumChannel1U: AugmentedModule['Error_BadNumChannel1U']
/**
   * BadDepth=                  -17,  //!< input image depth is not supported by the function
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/exception.hpp#L35
   */
  BAD_NUM_CHANNEL1U: AugmentedModule['Error_BAD_NUM_CHANNEL1U']
/**
   * input image depth is not supported by the function
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/exception.hpp#L36
   */
  BadDepth: AugmentedModule['Error_BadDepth']
/**
   * input image depth is not supported by the function
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/exception.hpp#L36
   */
  BAD_DEPTH: AugmentedModule['Error_BAD_DEPTH']
/**
   * BadOrder=                  -19,  //!< number of dimensions is out of range
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/exception.hpp#L37
   */
  BadAlphaChannel: AugmentedModule['Error_BadAlphaChannel']
/**
   * BadOrder=                  -19,  //!< number of dimensions is out of range
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/exception.hpp#L37
   */
  BAD_ALPHA_CHANNEL: AugmentedModule['Error_BAD_ALPHA_CHANNEL']
/**
   * number of dimensions is out of range
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/exception.hpp#L38
   */
  BadOrder: AugmentedModule['Error_BadOrder']
/**
   * number of dimensions is out of range
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/exception.hpp#L38
   */
  BAD_ORDER: AugmentedModule['Error_BAD_ORDER']
/**
   * incorrect input origin
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/exception.hpp#L39
   */
  BadOrigin: AugmentedModule['Error_BadOrigin']
/**
   * incorrect input origin
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/exception.hpp#L39
   */
  BAD_ORIGIN: AugmentedModule['Error_BAD_ORIGIN']
/**
   * incorrect input align
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/exception.hpp#L40
   */
  BadAlign: AugmentedModule['Error_BadAlign']
/**
   * incorrect input align
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/exception.hpp#L40
   */
  BAD_ALIGN: AugmentedModule['Error_BAD_ALIGN']
/**
   * BadTileSize=               -23,  //!<
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/exception.hpp#L41
   */
  BadCallBack: AugmentedModule['Error_BadCallBack']
/**
   * BadTileSize=               -23,  //!<
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/exception.hpp#L41
   */
  BAD_CALL_BACK: AugmentedModule['Error_BAD_CALL_BACK']
/**
   * error bad tile size constant (-23), defined by OpenCV for cv::Error.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/exception.hpp#L42
   */
  BadTileSize: AugmentedModule['Error_BadTileSize']
/**
   * error bad tile size constant (-23), defined by OpenCV for cv::Error.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/exception.hpp#L42
   */
  BAD_TILE_SIZE: AugmentedModule['Error_BAD_TILE_SIZE']
/**
   * input COI is not supported
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/exception.hpp#L43
   */
  BadCOI: AugmentedModule['Error_BadCOI']
/**
   * input COI is not supported
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/exception.hpp#L43
   */
  BAD_COI: AugmentedModule['Error_BAD_COI']
/**
   * incorrect input roi
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/exception.hpp#L44
   */
  BadROISize: AugmentedModule['Error_BadROISize']
/**
   * incorrect input roi
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/exception.hpp#L44
   */
  BAD_ROISIZE: AugmentedModule['Error_BAD_ROISIZE']
/**
   * StsNullPtr=                -27,  //!< null pointer
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/exception.hpp#L45
   */
  MaskIsTiled: AugmentedModule['Error_MaskIsTiled']
/**
   * StsNullPtr=                -27,  //!< null pointer
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/exception.hpp#L45
   */
  MASK_IS_TILED: AugmentedModule['Error_MASK_IS_TILED']
/**
   * Error_StsNullPtr: null pointer
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/exception.hpp#L46
   */
  StsNullPtr: AugmentedModule['Error_StsNullPtr']
/**
   * Error_STS_NULL_PTR: null pointer
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/exception.hpp#L46
   */
  STS_NULL_PTR: AugmentedModule['Error_STS_NULL_PTR']
/**
   * incorrect vector length
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/exception.hpp#L47
   */
  StsVecLengthErr: AugmentedModule['Error_StsVecLengthErr']
/**
   * incorrect vector length
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/exception.hpp#L47
   */
  STS_VEC_LENGTH_ERR: AugmentedModule['Error_STS_VEC_LENGTH_ERR']
/**
   * incorrect filter structure content
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/exception.hpp#L48
   */
  StsFilterStructContentErr: AugmentedModule['Error_StsFilterStructContentErr']
/**
   * incorrect filter structure content
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/exception.hpp#L48
   */
  STS_FILTER_STRUCT_CONTENT_ERR: AugmentedModule['Error_STS_FILTER_STRUCT_CONTENT_ERR']
/**
   * incorrect transform kernel content
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/exception.hpp#L49
   */
  StsKernelStructContentErr: AugmentedModule['Error_StsKernelStructContentErr']
/**
   * incorrect transform kernel content
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/exception.hpp#L49
   */
  STS_KERNEL_STRUCT_CONTENT_ERR: AugmentedModule['Error_STS_KERNEL_STRUCT_CONTENT_ERR']
/**
   * incorrect filter offset value
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/exception.hpp#L50
   */
  StsFilterOffsetErr: AugmentedModule['Error_StsFilterOffsetErr']
/**
   * incorrect filter offset value
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/exception.hpp#L50
   */
  STS_FILTER_OFFSET_ERR: AugmentedModule['Error_STS_FILTER_OFFSET_ERR']
/**
   * the input/output structure size is incorrect
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/exception.hpp#L51
   */
  StsBadSize: AugmentedModule['Error_StsBadSize']
/**
   * the input/output structure size is incorrect
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/exception.hpp#L51
   */
  STS_BAD_SIZE: AugmentedModule['Error_STS_BAD_SIZE']
/**
   * division by zero
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/exception.hpp#L52
   */
  StsDivByZero: AugmentedModule['Error_StsDivByZero']
/**
   * division by zero
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/exception.hpp#L52
   */
  STS_DIV_BY_ZERO: AugmentedModule['Error_STS_DIV_BY_ZERO']
/**
   * in-place operation is not supported
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/exception.hpp#L53
   */
  StsInplaceNotSupported: AugmentedModule['Error_StsInplaceNotSupported']
/**
   * in-place operation is not supported
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/exception.hpp#L53
   */
  STS_INPLACE_NOT_SUPPORTED: AugmentedModule['Error_STS_INPLACE_NOT_SUPPORTED']
/**
   * request can't be completed
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/exception.hpp#L54
   */
  StsObjectNotFound: AugmentedModule['Error_StsObjectNotFound']
/**
   * request can't be completed
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/exception.hpp#L54
   */
  STS_OBJECT_NOT_FOUND: AugmentedModule['Error_STS_OBJECT_NOT_FOUND']
/**
   * formats of input/output arrays differ
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/exception.hpp#L55
   */
  StsUnmatchedFormats: AugmentedModule['Error_StsUnmatchedFormats']
/**
   * formats of input/output arrays differ
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/exception.hpp#L55
   */
  STS_UNMATCHED_FORMATS: AugmentedModule['Error_STS_UNMATCHED_FORMATS']
/**
   * flag is wrong or not supported
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/exception.hpp#L56
   */
  StsBadFlag: AugmentedModule['Error_StsBadFlag']
/**
   * flag is wrong or not supported
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/exception.hpp#L56
   */
  STS_BAD_FLAG: AugmentedModule['Error_STS_BAD_FLAG']
/**
   * Error_StsBadPoint: bad CvPoint
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/exception.hpp#L57
   */
  StsBadPoint: AugmentedModule['Error_StsBadPoint']
/**
   * Error_STS_BAD_POINT: bad CvPoint
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/exception.hpp#L57
   */
  STS_BAD_POINT: AugmentedModule['Error_STS_BAD_POINT']
/**
   * bad format of mask (neither 8uC1 nor 8sC1)
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/exception.hpp#L58
   */
  StsBadMask: AugmentedModule['Error_StsBadMask']
/**
   * bad format of mask (neither 8uC1 nor 8sC1)
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/exception.hpp#L58
   */
  STS_BAD_MASK: AugmentedModule['Error_STS_BAD_MASK']
/**
   * sizes of input/output structures do not match
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/exception.hpp#L59
   */
  StsUnmatchedSizes: AugmentedModule['Error_StsUnmatchedSizes']
/**
   * sizes of input/output structures do not match
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/exception.hpp#L59
   */
  STS_UNMATCHED_SIZES: AugmentedModule['Error_STS_UNMATCHED_SIZES']
/**
   * the data format/type is not supported by the function
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/exception.hpp#L60
   */
  StsUnsupportedFormat: AugmentedModule['Error_StsUnsupportedFormat']
/**
   * the data format/type is not supported by the function
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/exception.hpp#L60
   */
  STS_UNSUPPORTED_FORMAT: AugmentedModule['Error_STS_UNSUPPORTED_FORMAT']
/**
   * some of parameters are out of range
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/exception.hpp#L61
   */
  StsOutOfRange: AugmentedModule['Error_StsOutOfRange']
/**
   * some of parameters are out of range
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/exception.hpp#L61
   */
  STS_OUT_OF_RANGE: AugmentedModule['Error_STS_OUT_OF_RANGE']
/**
   * invalid syntax/structure of the parsed file
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/exception.hpp#L62
   */
  StsParseError: AugmentedModule['Error_StsParseError']
/**
   * invalid syntax/structure of the parsed file
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/exception.hpp#L62
   */
  STS_PARSE_ERROR: AugmentedModule['Error_STS_PARSE_ERROR']
/**
   * the requested function/feature is not implemented
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/exception.hpp#L63
   */
  StsNotImplemented: AugmentedModule['Error_StsNotImplemented']
/**
   * the requested function/feature is not implemented
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/exception.hpp#L63
   */
  STS_NOT_IMPLEMENTED: AugmentedModule['Error_STS_NOT_IMPLEMENTED']
/**
   * an allocated block has been corrupted
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/exception.hpp#L64
   */
  StsBadMemBlock: AugmentedModule['Error_StsBadMemBlock']
/**
   * an allocated block has been corrupted
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/exception.hpp#L64
   */
  STS_BAD_MEM_BLOCK: AugmentedModule['Error_STS_BAD_MEM_BLOCK']
/**
   * assertion failed
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/exception.hpp#L65
   */
  StsAssert: AugmentedModule['Error_StsAssert']
/**
   * assertion failed
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/exception.hpp#L65
   */
  STS_ASSERT: AugmentedModule['Error_STS_ASSERT']
/**
   * no CUDA support
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/exception.hpp#L66
   */
  GpuNotSupported: AugmentedModule['Error_GpuNotSupported']
/**
   * no CUDA support
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/exception.hpp#L66
   */
  GPU_NOT_SUPPORTED: AugmentedModule['Error_GPU_NOT_SUPPORTED']
/**
   * GPU API call error
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/exception.hpp#L67
   */
  GpuApiCallError: AugmentedModule['Error_GpuApiCallError']
/**
   * GPU API call error
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/exception.hpp#L67
   */
  GPU_API_CALL_ERROR: AugmentedModule['Error_GPU_API_CALL_ERROR']
/**
   * no OpenGL support
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/exception.hpp#L68
   */
  OpenGlNotSupported: AugmentedModule['Error_OpenGlNotSupported']
/**
   * no OpenGL support
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/exception.hpp#L68
   */
  OPEN_GL_NOT_SUPPORTED: AugmentedModule['Error_OPEN_GL_NOT_SUPPORTED']
/**
   * OpenGL API call error
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/exception.hpp#L69
   */
  OpenGlApiCallError: AugmentedModule['Error_OpenGlApiCallError']
/**
   * OpenGL API call error
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/exception.hpp#L69
   */
  OPEN_GL_API_CALL_ERROR: AugmentedModule['Error_OPEN_GL_API_CALL_ERROR']
/**
   * OpenCL API call error
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/exception.hpp#L70
   */
  OpenCLApiCallError: AugmentedModule['Error_OpenCLApiCallError']
/**
   * OpenCL API call error
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/exception.hpp#L70
   */
  OPEN_CLAPI_CALL_ERROR: AugmentedModule['Error_OPEN_CLAPI_CALL_ERROR']
/**
   * OpenCL API call error
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/exception.hpp#L71
   */
  OpenCLDoubleNotSupported: AugmentedModule['Error_OpenCLDoubleNotSupported']
/**
   * OpenCL API call error
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/exception.hpp#L71
   */
  OPEN_CLDOUBLE_NOT_SUPPORTED: AugmentedModule['Error_OPEN_CLDOUBLE_NOT_SUPPORTED']
/**
   * OpenCL initialization error
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/exception.hpp#L72
   */
  OpenCLInitError: AugmentedModule['Error_OpenCLInitError']
/**
   * OpenCL initialization error
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/exception.hpp#L72
   */
  OPEN_CLINIT_ERROR: AugmentedModule['Error_OPEN_CLINIT_ERROR']
/**
   * OpenCL initialization error
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/exception.hpp#L73
   */
  OpenCLNoAMDBlasFft: AugmentedModule['Error_OpenCLNoAMDBlasFft']
/**
   * OpenCL initialization error
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/exception.hpp#L73
   */
  OPEN_CLNO_AMDBLAS_FFT: AugmentedModule['Error_OPEN_CLNO_AMDBLAS_FFT']
}
  /** Native face namespace. */
  face: CVNamespace<'face'> & {
/**
   * Abstract base class for all face recognition models
   *
   * All face recognition models in OpenCV are derived from the abstract base class FaceRecognizer, which
   * provides a unified access to all face recongition algorithms in OpenCV.
   *
   * ### Description
   *
   * I'll go a bit more into detail explaining FaceRecognizer, because it doesn't look like a powerful
   * interface at first sight. But: Every FaceRecognizer is an Algorithm, so you can easily get/set all
   * model internals (if allowed by the implementation). Algorithm is a relatively new OpenCV concept,
   * which is available since the 2.4 release. I suggest you take a look at its description.
   *
   * Algorithm provides the following features for all derived classes:
   *
   * -   So called "virtual constructor". That is, each Algorithm derivative is registered at program
   *     start and you can get the list of registered algorithms and create instance of a particular
   *     algorithm by its name (see Algorithm::create). If you plan to add your own algorithms, it is
   *     good practice to add a unique prefix to your algorithms to distinguish them from other
   *     algorithms.
   * -   Setting/Retrieving algorithm parameters by name. If you used video capturing functionality from
   *     OpenCV highgui module, you are probably familar with cv::cvSetCaptureProperty,
   * ocvcvGetCaptureProperty, VideoCapture::set and VideoCapture::get. Algorithm provides similar
   *     method where instead of integer id's you specify the parameter names as text Strings. See
   *     Algorithm::set and Algorithm::get for details.
   * -   Reading and writing parameters from/to XML or YAML files. Every Algorithm derivative can store
   *     all its parameters and then read them back. There is no need to re-implement it each time.
   *
   * Moreover every FaceRecognizer supports the:
   *
   * -   **Training** of a FaceRecognizer with FaceRecognizer::train on a given set of images (your face
   *     database!).
   * -   **Prediction** of a given sample image, that means a face. The image is given as a Mat.
   * -   **Loading/Saving** the model state from/to a given XML or YAML.
   * -   **Setting/Getting labels info**, that is stored as a string. String labels info is useful for
   *     keeping names of the recognized people.
   *
   * **Note:** When using the FaceRecognizer interface in combination with Python, please stick to Python 2.
   * Some underlying scripts like create_csv will not work in other versions, like Python 3. Setting the
   * Thresholds +++++++++++++++++++++++
   *
   * Sometimes you run into the situation, when you want to apply a threshold on the prediction. A common
   * scenario in face recognition is to tell, whether a face belongs to the training dataset or if it is
   * unknown. You might wonder, why there's no public API in FaceRecognizer to set the threshold for the
   * prediction, but rest assured: It's supported. It just means there's no generic way in an abstract
   * class to provide an interface for setting/getting the thresholds of *every possible* FaceRecognizer
   * algorithm. The appropriate place to set the thresholds is in the constructor of the specific
   * FaceRecognizer and since every FaceRecognizer is a Algorithm (see above), you can get/set the
   * thresholds at runtime!
   *
   * Here is an example of setting a threshold for the Eigenfaces method, when creating the model:
   *
   * ```cpp
   * // Let's say we want to keep 10 Eigenfaces and have a threshold value of 10.0
   * int num_components = 10;
   * double threshold = 10.0;
   * // Then if you want to have a cv::FaceRecognizer with a confidence threshold,
   * // create the concrete implementation with the appropriate parameters:
   * Ptr<FaceRecognizer> model = EigenFaceRecognizer::create(num_components, threshold);
   *
   * ```
   *
   * Sometimes it's impossible to train the model, just to experiment with threshold values. Thanks to
   * Algorithm it's possible to set internal model thresholds during runtime. Let's see how we would
   * set/get the prediction for the Eigenface model, we've created above:
   *
   * ```cpp
   * // The following line reads the threshold from the Eigenfaces model:
   * double current_threshold = model->getDouble("threshold");
   * // And this line sets the threshold to 0.0:
   * model->set("threshold", 0.0);
   *
   * ```
   *
   * If you've set the threshold to 0.0 as we did above, then:
   *
   * ```cpp
   * //
   * Mat img = imread("person1/3.jpg", IMREAD_GRAYSCALE);
   * // Get a prediction from the model. Note: We've set a threshold of 0.0 above,
   * // since the distance is almost always larger than 0.0, you'll get -1 as
   * // label, which indicates, this face is unknown
   * int predicted_label = model->predict(img);
   * // ...
   *
   * ```
   *
   * is going to yield -1 as predicted label, which states this face is unknown.
   *
   * ### Getting the name of a FaceRecognizer
   *
   * Since every FaceRecognizer is a Algorithm, you can use Algorithm::name to get the name of a
   * FaceRecognizer:
   *
   * ```cpp
   * // Create a FaceRecognizer:
   * Ptr<FaceRecognizer> model = EigenFaceRecognizer::create();
   * // And here's how to get its name:
   * String name = model->name();
   *
   * ```
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/face/include/opencv2/face.hpp#L157
   */
  FaceRecognizer: AugmentedModule['face_FaceRecognizer']
/**
   * Implementation of bio-inspired features (BIF) from the paper:
   *  Guo, Guodong, et al. "Human age estimation using bio-inspired features."
   *  Computer Vision and Pattern Recognition, 2009. CVPR 2009.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/face/include/opencv2/face/bif.hpp#L57
   */
  BIF: AugmentedModule['face_BIF']
/**
   * Abstract base class for all facemark models
   *
   * To utilize this API in your program, please take a look at the `tutorial_table_of_content_facemark`
   * ### Description
   *
   * Facemark is a base class which provides universal access to any specific facemark algorithm.
   * Therefore, the users should declare a desired algorithm before they can use it in their application.
   *
   * Here is an example on how to declare a facemark algorithm:
   *
   * ```cpp
   * // Using Facemark in your code:
   * Ptr<Facemark> facemark = createFacemarkLBF();
   *
   * ```
   *
   * The typical pipeline for facemark detection is as follows:
   * - Load the trained model using Facemark::loadModel.
   * - Perform the fitting on an image via Facemark::fit.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/face/include/opencv2/face/facemark.hpp#L43
   */
  Facemark: AugmentedModule['face_Facemark']
/**
   * face facemark kazemi value in the OpenCV API.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/face/include/opencv2/face/face_alignment.hpp#L11
   */
  FacemarkKazemi: AugmentedModule['face_FacemarkKazemi']
/**
   * Abstract base class for trainable facemark models
   *
   * To utilize this API in your program, please take a look at the `tutorial_table_of_content_facemark`
   * ### Description
   *
   * The AAM and LBF facemark models in OpenCV are derived from the abstract base class FacemarkTrain, which
   * provides a unified access to those facemark algorithms in OpenCV.
   *
   * Here is an example on how to declare facemark algorithm:
   *
   * ```cpp
   * // Using Facemark in your code:
   * Ptr<Facemark> facemark = FacemarkLBF::create();
   *
   * ```
   *
   * The typical pipeline for facemark detection is listed as follows:
   * - (Non-mandatory) Set a user defined face detection using FacemarkTrain::setFaceDetector.
   *   The facemark algorithms are designed to fit the facial points into a face.
   *   Therefore, the face information should be provided to the facemark algorithm.
   *   Some algorithms might provides a default face recognition function.
   *   However, the users might prefer to use their own face detector to obtains the best possible detection result.
   * - (Non-mandatory) Training the model for a specific algorithm using FacemarkTrain::training.
   *   In this case, the model should be automatically saved by the algorithm.
   *   If the user already have a trained model, then this part can be omitted.
   * - Load the trained model using Facemark::loadModel.
   * - Perform the fitting via the Facemark::fit.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/face/include/opencv2/face/facemark_train.hpp#L256
   */
  FacemarkTrain: AugmentedModule['face_FacemarkTrain']
/**
   * face facemark aam value in the OpenCV API.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/face/include/opencv2/face/facemarkAAM.hpp#L47
   */
  FacemarkAAM: AugmentedModule['face_FacemarkAAM']
/**
   * face facemark lbf value in the OpenCV API.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/face/include/opencv2/face/facemarkLBF.hpp#L48
   */
  FacemarkLBF: AugmentedModule['face_FacemarkLBF']
/**
   * base for two classes
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/face/include/opencv2/face/facerec.hpp#L20
   */
  BasicFaceRecognizer: AugmentedModule['face_BasicFaceRecognizer']
/**
   * face eigen face recognizer value in the OpenCV API.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/face/include/opencv2/face/facerec.hpp#L54
   */
  EigenFaceRecognizer: AugmentedModule['face_EigenFaceRecognizer']
/**
   * face fisher face recognizer value in the OpenCV API.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/face/include/opencv2/face/facerec.hpp#L89
   */
  FisherFaceRecognizer: AugmentedModule['face_FisherFaceRecognizer']
/**
   * face lbphface recognizer value in the OpenCV API.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/face/include/opencv2/face/facerec.hpp#L126
   */
  LBPHFaceRecognizer: AugmentedModule['face_LBPHFaceRecognizer']
/**
   * Minimum Average Correlation Energy Filter
   *     useful for authentication with (cancellable) biometrical features.
   *     (does not need many positives to train (10-50), and no negatives at all, also robust to noise/salting)
   *
   *     see also: [Savvides04]
   *
   *     this implementation is largely based on: https://code.google.com/archive/p/pam-face-authentication (GSOC 2009)
   *
   *     use it like:
   *     
   * ```cpp
   *
   *     Ptr<face::MACE> mace = face::MACE::create(64);
   *
   *     vector<Mat> pos_images = ...
   *     mace->train(pos_images);
   *
   *     Mat query = ...
   *     bool same = mace->same(query);
   *
   * ```
   *
   *     you can also use two-factor authentication, with an additional passphrase:
   *
   * ```cpp
   *     String owners_passphrase = "ilikehotdogs";
   *     Ptr<face::MACE> mace = face::MACE::create(64);
   *     mace->salt(owners_passphrase);
   *     vector<Mat> pos_images = ...
   *     mace->train(pos_images);
   *
   *     // now, users have to give a valid passphrase, along with the image:
   *     Mat query = ...
   *     cout << "enter passphrase: ";
   *     string pass;
   *     getline(cin, pass);
   *     mace->salt(pass);
   *     bool same = mace->same(query);
   *     
   * ```
   *
   *     save/load your model:
   *     
   * ```cpp
   *     Ptr<face::MACE> mace = face::MACE::create(64);
   *     mace->train(pos_images);
   *     mace->save("my_mace.xml");
   *
   *     // later:
   *     Ptr<MACE> reloaded = MACE::load("my_mace.xml");
   *     reloaded->same(some_image);
   *     
   * ```
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/face/include/opencv2/face/mace.hpp#L71
   */
  MACE: AugmentedModule['face_MACE']
/**
   * Abstract base class for all strategies of prediction result handling
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/face/include/opencv2/face/predict_collector.hpp#L61
   */
  PredictCollector: AugmentedModule['face_PredictCollector']
/**
   * Default predict collector
   *
   * Trace minimal distance with treshhold checking (that is default behavior for most predict logic)
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/face/include/opencv2/face/predict_collector.hpp#L82
   */
  StandardCollector: AugmentedModule['face_StandardCollector']
}
  /** Native fisheye namespace. */
  fisheye: CVNamespace<'fisheye'> & {

}
  /** Native flann namespace. */
  flann: CVNamespace<'flann'> & {
/**
   * flann distance type value in the OpenCV API.
   */
  DistanceType: AugmentedModule['flann_DistanceType']
/**
   * Named configuration values used when constructing a FLANN nearest-neighbor index.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/flann/include/opencv2/flann/miniflann.hpp#L71
   */
  IndexParams: AugmentedModule['flann_IndexParams']
/**
   * Search configuration controlling the number of examined leaves, approximation tolerance and result ordering.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/flann/include/opencv2/flann/miniflann.hpp#L144
   */
  SearchParams: AugmentedModule['flann_SearchParams']
/**
   * Configuration for a randomized forest of kd-trees used to search floating-point descriptors.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/flann/include/opencv2/flann/miniflann.hpp#L100
   */
  KDTreeIndexParams: AugmentedModule['flann_KDTreeIndexParams']
/**
   * Configuration for exhaustive nearest-neighbor search over all descriptor rows.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/flann/include/opencv2/flann/miniflann.hpp#L105
   */
  LinearIndexParams: AugmentedModule['flann_LinearIndexParams']
/**
   * Configuration for a locality-sensitive hashing index over binary descriptors.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/flann/include/opencv2/flann/miniflann.hpp#L134
   */
  LshIndexParams: AugmentedModule['flann_LshIndexParams']
/**
   * A nearest-neighbor search index over feature vectors. Choose index and search parameters for the descriptor type and distance metric.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/flann/include/opencv2/flann/miniflann.hpp#L150
   */
  Index: AugmentedModule['flann_Index']
/**
   * Native enum entries for flann flann index type. Pass an entry to enum-typed arguments or its .value to numeric arguments.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/flann/include/opencv2/flann/miniflann.hpp#L57
   */
  FlannIndexType: AugmentedModule['flann_FlannIndexType']
/**
   * flann flann index type 8 u constant (CV_8U), defined by OpenCV for cv::flann.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/flann/include/opencv2/flann/miniflann.hpp#L58
   */
  FLANN_INDEX_TYPE_8U: AugmentedModule['flann_FLANN_INDEX_TYPE_8U']
/**
   * flann flann index type 8 s constant (CV_8S), defined by OpenCV for cv::flann.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/flann/include/opencv2/flann/miniflann.hpp#L59
   */
  FLANN_INDEX_TYPE_8S: AugmentedModule['flann_FLANN_INDEX_TYPE_8S']
/**
   * flann flann index type 16 u constant (CV_16U), defined by OpenCV for cv::flann.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/flann/include/opencv2/flann/miniflann.hpp#L60
   */
  FLANN_INDEX_TYPE_16U: AugmentedModule['flann_FLANN_INDEX_TYPE_16U']
/**
   * flann flann index type 16 s constant (CV_16S), defined by OpenCV for cv::flann.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/flann/include/opencv2/flann/miniflann.hpp#L61
   */
  FLANN_INDEX_TYPE_16S: AugmentedModule['flann_FLANN_INDEX_TYPE_16S']
/**
   * flann flann index type 32 s constant (CV_32S), defined by OpenCV for cv::flann.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/flann/include/opencv2/flann/miniflann.hpp#L62
   */
  FLANN_INDEX_TYPE_32S: AugmentedModule['flann_FLANN_INDEX_TYPE_32S']
/**
   * flann flann index type 32 f constant (CV_32F), defined by OpenCV for cv::flann.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/flann/include/opencv2/flann/miniflann.hpp#L63
   */
  FLANN_INDEX_TYPE_32F: AugmentedModule['flann_FLANN_INDEX_TYPE_32F']
/**
   * flann flann index type 64 f constant (CV_64F), defined by OpenCV for cv::flann.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/flann/include/opencv2/flann/miniflann.hpp#L64
   */
  FLANN_INDEX_TYPE_64F: AugmentedModule['flann_FLANN_INDEX_TYPE_64F']
/**
   * flann flann index type string constant (CV_64F+1), defined by OpenCV for cv::flann.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/flann/include/opencv2/flann/miniflann.hpp#L65
   */
  FLANN_INDEX_TYPE_STRING: AugmentedModule['flann_FLANN_INDEX_TYPE_STRING']
/**
   * flann flann index type bool constant (CV_64F+2), defined by OpenCV for cv::flann.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/flann/include/opencv2/flann/miniflann.hpp#L66
   */
  FLANN_INDEX_TYPE_BOOL: AugmentedModule['flann_FLANN_INDEX_TYPE_BOOL']
/**
   * flann flann index type algorithm constant (CV_64F+3), defined by OpenCV for cv::flann.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/flann/include/opencv2/flann/miniflann.hpp#L68
   */
  FLANN_INDEX_TYPE_ALGORITHM: AugmentedModule['flann_FLANN_INDEX_TYPE_ALGORITHM']
/**
   * flann last value flann index type constant (FLANN_INDEX_TYPE_ALGORITHM), defined by OpenCV for cv::flann.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/flann/include/opencv2/flann/miniflann.hpp#L68
   */
  LAST_VALUE_FLANN_INDEX_TYPE: AugmentedModule['flann_LAST_VALUE_FLANN_INDEX_TYPE']
}
  /** Native freetype namespace. */
  freetype: CVNamespace<'freetype'> & {
/**
   * freetype free type2 value in the OpenCV API.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/freetype/include/opencv2/freetype.hpp#L74
   */
  FreeType2: AugmentedModule['freetype_FreeType2']
}
  /** Native ft namespace. */
  ft: CVNamespace<'ft'> & {
/**
   * linear (triangular) shape
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/fuzzy/include/opencv2/fuzzy/types.hpp#L55
   */
  LINEAR: AugmentedModule['ft_LINEAR']
/**
   * sinusoidal shape
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/fuzzy/include/opencv2/fuzzy/types.hpp#L56
   */
  SINUS: AugmentedModule['ft_SINUS']
/**
   * processing in one step
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/fuzzy/include/opencv2/fuzzy/types.hpp#L61
   */
  ONE_STEP: AugmentedModule['ft_ONE_STEP']
/**
   * processing in multiple step
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/fuzzy/include/opencv2/fuzzy/types.hpp#L62
   */
  MULTI_STEP: AugmentedModule['ft_MULTI_STEP']
/**
   * processing in several iterations
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/fuzzy/include/opencv2/fuzzy/types.hpp#L63
   */
  ITERATIVE: AugmentedModule['ft_ITERATIVE']
}
  /** Native gapi namespace. */
  gapi: CVNamespace<'gapi'> & {
/**
   * Configuration for a named OpenCV DNN graph network. Retains the supplied Net and selects its CPU backend. Configure image preprocessing before packaging with `cv.gapi.networks`.
   */
  dnn_Params: AugmentedModule['gapi_dnn_Params']
/**
   * An owned native vector. Append values with push_back, read them with get, and release the vector with using or delete(). Native object elements returned by get require separate disposal.
   */
  _GNetParamVector: AugmentedModule['gapi__GNetParamVector']
/**
   * Specify queue capacity for streaming execution.
   *
   * In the streaming mode the pipeline steps are connected with queues
   * and this compile argument controls every queue's size.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/gstreaming.hpp#L408
   */
  streaming_queue_capacity: AugmentedModule['gapi_streaming_queue_capacity']
/**
   * Note: the below code _is_ part of STANDALONE build,
   * just to make our compiler code compileable.
   * A type-erased form of network parameters.
   * Similar to how a type-erased GKernel is represented and used.
   * private:
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/infer.hpp#L661
   */
  GNetParam: AugmentedModule['gapi_GNetParam']
/**
   * \addtogroup gapi_compile_args
   *
   * A container class for network configurations. Similar to
   * GKernelPackage. Use cv::gapi::networks() to construct this object.
   *
   * See: cv::gapi::networks
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/infer.hpp#L676
   */
  GNetPackage: AugmentedModule['gapi_GNetPackage']
/**
   * NB: Used by python wrapper
   * This class can be marked as SIMPLE, because it's implemented as pimpl
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/infer/bindings_ie.hpp#L23
   */
  ie_PyParams: AugmentedModule['gapi_ie_PyParams']
/**
   * NB: Used by python wrapper
   * This class can be marked as SIMPLE, because it's implemented as pimpl
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/infer/bindings_onnx.hpp#L21
   */
  onnx_PyParams: AugmentedModule['gapi_onnx_PyParams']
/**
   * NB: Used by python wrapper
   * This class can be marked as SIMPLE, because it's implemented as pimpl
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/infer/bindings_ov.hpp#L23
   */
  ov_PyParams: AugmentedModule['gapi_ov_PyParams']
/**
   * This structure provides functions
   * that fill inference options for ONNX CoreML Execution Provider.
   * Please follow https://onnxruntime.ai/docs/execution-providers/CoreML-ExecutionProvider.html#coreml-execution-provider
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/infer/onnx.hpp#L43
   */
  onnx_ep_CoreML: AugmentedModule['gapi_onnx_ep_CoreML']
/**
   * This structure provides functions
   * that fill inference options for CUDA Execution Provider.
   * Please follow https://onnxruntime.ai/docs/execution-providers/CUDA-ExecutionProvider.html#cuda-execution-provider
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/infer/onnx.hpp#L102
   */
  onnx_ep_CUDA: AugmentedModule['gapi_onnx_ep_CUDA']
/**
   * This structure provides functions
   * that fill inference options for TensorRT Execution Provider.
   * Please follow https://onnxruntime.ai/docs/execution-providers/TensorRT-ExecutionProvider.html#tensorrt-execution-provider
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/infer/onnx.hpp#L127
   */
  onnx_ep_TensorRT: AugmentedModule['gapi_onnx_ep_TensorRT']
/**
   * This structure provides functions
   * that fill inference options for ONNX OpenVINO Execution Provider.
   * Please follow https://onnxruntime.ai/docs/execution-providers/OpenVINO-ExecutionProvider.html#summary-of-options
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/infer/onnx.hpp#L152
   */
  onnx_ep_OpenVINO: AugmentedModule['gapi_onnx_ep_OpenVINO']
/**
   * This structure provides functions
   * that fill inference options for ONNX DirectML Execution Provider.
   * Please follow https://onnxruntime.ai/docs/execution-providers/DirectML-ExecutionProvider.html#directml-execution-provider
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/infer/onnx.hpp#L266
   */
  onnx_ep_DirectML: AugmentedModule['gapi_onnx_ep_DirectML']
/**
   * gapi ot object tracker params value in the OpenCV API.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/ot.hpp#L35
   */
  ot_ObjectTrackerParams: AugmentedModule['gapi_ot_ObjectTrackerParams']
/**
   * This structure represents a text string to draw.
   *
   * Parameters match cv::putText().
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/render/render_types.hpp#L44
   */
  wip_draw_Text: AugmentedModule['gapi_wip_draw_Text']
/**
   * This structure represents a rectangle to draw.
   *
   * Parameters match cv::rectangle().
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/render/render_types.hpp#L127
   */
  wip_draw_Rect: AugmentedModule['gapi_wip_draw_Rect']
/**
   * This structure represents a circle to draw.
   *
   * Parameters match cv::circle().
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/render/render_types.hpp#L164
   */
  wip_draw_Circle: AugmentedModule['gapi_wip_draw_Circle']
/**
   * This structure represents a line to draw.
   *
   * Parameters match cv::line().
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/render/render_types.hpp#L205
   */
  wip_draw_Line: AugmentedModule['gapi_wip_draw_Line']
/**
   * This structure represents a mosaicing operation.
   *
   * Mosaicing is a very basic method to obfuscate regions in the image.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/render/render_types.hpp#L246
   */
  wip_draw_Mosaic: AugmentedModule['gapi_wip_draw_Mosaic']
/**
   * This structure represents an image to draw.
   *
   * Image is blended on a frame using the specified mask.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/render/render_types.hpp#L277
   */
  wip_draw_Image: AugmentedModule['gapi_wip_draw_Image']
/**
   * This structure represents a polygon to draw.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/render/render_types.hpp#L307
   */
  wip_draw_Poly: AugmentedModule['gapi_wip_draw_Poly']
/**
   * gapi wip gst gstreamer pipeline value in the OpenCV API.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/streaming/gstreamer/gstreamerpipeline.hpp#L22
   */
  wip_gst_GStreamerPipeline: AugmentedModule['gapi_wip_gst_GStreamerPipeline']
/**
   * The enum specified format of result that you get from `cv::gapi::stereo.`
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/stereo.hpp#L20
   */
  StereoOutputFormat: AugmentedModule['gapi_StereoOutputFormat']
/**
   * Same as DEPTH_FLOAT16
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/stereo.hpp#L35
   */
  StereoOutputFormat_DEPTH_FLOAT16: AugmentedModule['gapi_StereoOutputFormat_DEPTH_FLOAT16']
/**
   * Same as DEPTH_FLOAT16
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/stereo.hpp#L35
   */
  STEREO_OUTPUT_FORMAT_DEPTH_FLOAT16: AugmentedModule['gapi_STEREO_OUTPUT_FORMAT_DEPTH_FLOAT16']
/**
   * Same as DEPTH_FLOAT32
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/stereo.hpp#L36
   */
  StereoOutputFormat_DEPTH_FLOAT32: AugmentedModule['gapi_StereoOutputFormat_DEPTH_FLOAT32']
/**
   * Same as DEPTH_FLOAT32
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/stereo.hpp#L36
   */
  STEREO_OUTPUT_FORMAT_DEPTH_FLOAT32: AugmentedModule['gapi_STEREO_OUTPUT_FORMAT_DEPTH_FLOAT32']
/**
   * Same as DISPARITY_FIXED16_11_5
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/stereo.hpp#L37
   */
  StereoOutputFormat_DISPARITY_FIXED16_11_5: AugmentedModule['gapi_StereoOutputFormat_DISPARITY_FIXED16_11_5']
/**
   * Same as DISPARITY_FIXED16_11_5
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/stereo.hpp#L37
   */
  STEREO_OUTPUT_FORMAT_DISPARITY_FIXED16_11_5: AugmentedModule['gapi_STEREO_OUTPUT_FORMAT_DISPARITY_FIXED16_11_5']
/**
   * Same as DISPARITY_FIXED16_12_4
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/stereo.hpp#L38
   */
  StereoOutputFormat_DISPARITY_FIXED16_12_4: AugmentedModule['gapi_StereoOutputFormat_DISPARITY_FIXED16_12_4']
/**
   * Same as DISPARITY_FIXED16_12_4
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/stereo.hpp#L38
   */
  STEREO_OUTPUT_FORMAT_DISPARITY_FIXED16_12_4: AugmentedModule['gapi_STEREO_OUTPUT_FORMAT_DISPARITY_FIXED16_12_4']
/**
   * Same as DEPTH_FLOAT16
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/stereo.hpp#L35
   */
  StereoOutputFormat_DEPTH_16F: AugmentedModule['gapi_StereoOutputFormat_DEPTH_16F']
/**
   * Same as DEPTH_FLOAT16
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/stereo.hpp#L35
   */
  STEREO_OUTPUT_FORMAT_DEPTH_16F: AugmentedModule['gapi_STEREO_OUTPUT_FORMAT_DEPTH_16F']
/**
   * Same as DEPTH_FLOAT32
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/stereo.hpp#L36
   */
  StereoOutputFormat_DEPTH_32F: AugmentedModule['gapi_StereoOutputFormat_DEPTH_32F']
/**
   * Same as DEPTH_FLOAT32
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/stereo.hpp#L36
   */
  STEREO_OUTPUT_FORMAT_DEPTH_32F: AugmentedModule['gapi_STEREO_OUTPUT_FORMAT_DEPTH_32F']
/**
   * Same as DISPARITY_FIXED16_11_5
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/stereo.hpp#L37
   */
  StereoOutputFormat_DISPARITY_16Q_10_5: AugmentedModule['gapi_StereoOutputFormat_DISPARITY_16Q_10_5']
/**
   * Same as DISPARITY_FIXED16_11_5
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/stereo.hpp#L37
   */
  STEREO_OUTPUT_FORMAT_DISPARITY_16Q_10_5: AugmentedModule['gapi_STEREO_OUTPUT_FORMAT_DISPARITY_16Q_10_5']
/**
   * Same as DISPARITY_FIXED16_12_4
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/stereo.hpp#L38
   */
  StereoOutputFormat_DISPARITY_16Q_11_4: AugmentedModule['gapi_StereoOutputFormat_DISPARITY_16Q_11_4']
/**
   * Same as DISPARITY_FIXED16_12_4
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/stereo.hpp#L38
   */
  STEREO_OUTPUT_FORMAT_DISPARITY_16Q_11_4: AugmentedModule['gapi_STEREO_OUTPUT_FORMAT_DISPARITY_16Q_11_4']
/**
   * Native enum entries for gapi streaming sync policy. Pass an entry to enum-typed arguments or its .value to numeric arguments.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/streaming/sync.hpp#L14
   */
  streaming_sync_policy: AugmentedModule['gapi_streaming_sync_policy']
/**
   * gapi streaming sync policy dont sync constant (0), defined by OpenCV for cv::gapi::streaming::sync_policy.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/streaming/sync.hpp#L15
   */
  streaming_sync_policy_dont_sync: AugmentedModule['gapi_streaming_sync_policy_dont_sync']
/**
   * gapi streaming sync policy dont sync constant (0), defined by OpenCV for cv::gapi::streaming::sync_policy.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/streaming/sync.hpp#L15
   */
  streaming_SYNC_POLICY_DONT_SYNC: AugmentedModule['gapi_streaming_SYNC_POLICY_DONT_SYNC']
/**
   * gapi streaming sync policy drop constant (1), defined by OpenCV for cv::gapi::streaming::sync_policy.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/streaming/sync.hpp#L16
   */
  streaming_sync_policy_drop: AugmentedModule['gapi_streaming_sync_policy_drop']
/**
   * gapi streaming sync policy drop constant (1), defined by OpenCV for cv::gapi::streaming::sync_policy.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/streaming/sync.hpp#L16
   */
  streaming_SYNC_POLICY_DROP: AugmentedModule['gapi_streaming_SYNC_POLICY_DROP']
/**
   * Specifies how G-API and IE should trait input data
   *
   * In OpenCV, the same cv::Mat is used to represent both
   * image and tensor data. Sometimes those are hardly distinguishable,
   * so this extra parameter is used to give G-API a hint.
   *
   * This hint controls how G-API reinterprets the data when converting
   * it to IE Blob format (and which layout/etc is assigned to this data).
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/infer/ie.hpp#L47
   */
  ie_TraitAs: AugmentedModule['gapi_ie_TraitAs']
/**
   * Native enum entries for gapi ie infer mode. Pass an entry to enum-typed arguments or its .value to numeric arguments.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/infer/ie.hpp#L55
   */
  ie_InferMode: AugmentedModule['gapi_ie_InferMode']
/**
   * G-API traits an associated cv::Mat as a raw tensor and passes dimensions as-is
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/infer/ie.hpp#L49
   */
  ie_TraitAs_TENSOR: AugmentedModule['gapi_ie_TraitAs_TENSOR']
/**
   * G-API traits an associated cv::Mat as a raw tensor and passes dimensions as-is
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/infer/ie.hpp#L49
   */
  ie_TRAIT_AS_TENSOR: AugmentedModule['gapi_ie_TRAIT_AS_TENSOR']
/**
   * G-API traits an associated cv::Mat as an image so creates an "image" blob (NCHW/NHWC, etc)
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/infer/ie.hpp#L50
   */
  ie_TraitAs_IMAGE: AugmentedModule['gapi_ie_TraitAs_IMAGE']
/**
   * G-API traits an associated cv::Mat as an image so creates an "image" blob (NCHW/NHWC, etc)
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/infer/ie.hpp#L50
   */
  ie_TRAIT_AS_IMAGE: AugmentedModule['gapi_ie_TRAIT_AS_IMAGE']
/**
   * gapi ie sync constant (0), defined by OpenCV for cv::gapi::ie.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/infer/ie.hpp#L55
   */
  ie_Sync: AugmentedModule['gapi_ie_Sync']
/**
   * gapi ie sync constant (0), defined by OpenCV for cv::gapi::ie.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/infer/ie.hpp#L55
   */
  ie_SYNC: AugmentedModule['gapi_ie_SYNC']
/**
   * gapi ie async constant (1), defined by OpenCV for cv::gapi::ie.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/infer/ie.hpp#L55
   */
  ie_Async: AugmentedModule['gapi_ie_Async']
/**
   * gapi ie async constant (1), defined by OpenCV for cv::gapi::ie.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/infer/ie.hpp#L55
   */
  ie_ASYNC: AugmentedModule['gapi_ie_ASYNC']
/**
   * Native enum entries for gapi onnx trait as. Pass an entry to enum-typed arguments or its .value to numeric arguments.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/infer/onnx.hpp#L306
   */
  onnx_TraitAs: AugmentedModule['gapi_onnx_TraitAs']
/**
   * G-API traits an associated cv::Mat as a raw tensor
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/infer/onnx.hpp#L307
   */
  onnx_TraitAs_TENSOR: AugmentedModule['gapi_onnx_TraitAs_TENSOR']
/**
   * G-API traits an associated cv::Mat as a raw tensor
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/infer/onnx.hpp#L307
   */
  onnx_TRAIT_AS_TENSOR: AugmentedModule['gapi_onnx_TRAIT_AS_TENSOR']
/**
   * G-API traits an associated cv::Mat as an image so
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/infer/onnx.hpp#L309
   */
  onnx_TraitAs_IMAGE: AugmentedModule['gapi_onnx_TraitAs_IMAGE']
/**
   * G-API traits an associated cv::Mat as an image so
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/infer/onnx.hpp#L309
   */
  onnx_TRAIT_AS_IMAGE: AugmentedModule['gapi_onnx_TRAIT_AS_IMAGE']
/**
   * Native enum entries for gapi ie detail param desc kind. Pass an entry to enum-typed arguments or its .value to numeric arguments.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/infer/ie.hpp#L87
   */
  ie_detail_ParamDesc_Kind: AugmentedModule['gapi_ie_detail_ParamDesc_Kind']
/**
   * gapi ie detail param desc kind load constant (0), defined by OpenCV for cv::gapi::ie::detail::ParamDesc::Kind.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/infer/ie.hpp#L87
   */
  ie_detail_ParamDesc_Kind_Load: AugmentedModule['gapi_ie_detail_ParamDesc_Kind_Load']
/**
   * gapi ie detail param desc kind load constant (0), defined by OpenCV for cv::gapi::ie::detail::ParamDesc::Kind.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/infer/ie.hpp#L87
   */
  ie_detail_PARAM_DESC_KIND_LOAD: AugmentedModule['gapi_ie_detail_PARAM_DESC_KIND_LOAD']
/**
   * gapi ie detail param desc kind import constant (1), defined by OpenCV for cv::gapi::ie::detail::ParamDesc::Kind.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/infer/ie.hpp#L87
   */
  ie_detail_ParamDesc_Kind_Import: AugmentedModule['gapi_ie_detail_ParamDesc_Kind_Import']
/**
   * gapi ie detail param desc kind import constant (1), defined by OpenCV for cv::gapi::ie::detail::ParamDesc::Kind.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/infer/ie.hpp#L87
   */
  ie_detail_PARAM_DESC_KIND_IMPORT: AugmentedModule['gapi_ie_detail_PARAM_DESC_KIND_IMPORT']
/**
   * Rate control mode specifies if constant or variable bitrate should be used (H264 / H265)
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/oak/oak.hpp#L23
   */
  oak_EncoderConfig_RateControlMode: AugmentedModule['gapi_oak_EncoderConfig_RateControlMode']
/**
   * Encoding profile, H264, H265 or MJPEG
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/oak/oak.hpp#L28
   */
  oak_EncoderConfig_Profile: AugmentedModule['gapi_oak_EncoderConfig_Profile']
/**
   * gapi_oak_ColorCameraParams_BoardSocket: FIXME: extend
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/oak/oak.hpp#L121
   */
  oak_ColorCameraParams_BoardSocket: AugmentedModule['gapi_oak_ColorCameraParams_BoardSocket']
/**
   * gapi_oak_ColorCameraParams_Resolution: FIXME: extend
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/oak/oak.hpp#L126
   */
  oak_ColorCameraParams_Resolution: AugmentedModule['gapi_oak_ColorCameraParams_Resolution']
/**
   * Rate control mode specifies if constant or variable bitrate should be used (H264 / H265)
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/oak/oak.hpp#L23
   */
  oak_EncoderConfig_RateControlMode_CBR: AugmentedModule['gapi_oak_EncoderConfig_RateControlMode_CBR']
/**
   * Rate control mode specifies if constant or variable bitrate should be used (H264 / H265)
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/oak/oak.hpp#L23
   */
  oak_ENCODER_CONFIG_RATE_CONTROL_MODE_CBR: AugmentedModule['gapi_oak_ENCODER_CONFIG_RATE_CONTROL_MODE_CBR']
/**
   * Rate control mode specifies if constant or variable bitrate should be used (H264 / H265)
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/oak/oak.hpp#L23
   */
  oak_EncoderConfig_RateControlMode_VBR: AugmentedModule['gapi_oak_EncoderConfig_RateControlMode_VBR']
/**
   * Rate control mode specifies if constant or variable bitrate should be used (H264 / H265)
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/oak/oak.hpp#L23
   */
  oak_ENCODER_CONFIG_RATE_CONTROL_MODE_VBR: AugmentedModule['gapi_oak_ENCODER_CONFIG_RATE_CONTROL_MODE_VBR']
/**
   * Encoding profile, H264, H265 or MJPEG
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/oak/oak.hpp#L28
   */
  oak_EncoderConfig_Profile_H264_BASELINE: AugmentedModule['gapi_oak_EncoderConfig_Profile_H264_BASELINE']
/**
   * Encoding profile, H264, H265 or MJPEG
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/oak/oak.hpp#L28
   */
  oak_ENCODER_CONFIG_PROFILE_H264_BASELINE: AugmentedModule['gapi_oak_ENCODER_CONFIG_PROFILE_H264_BASELINE']
/**
   * Encoding profile, H264, H265 or MJPEG
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/oak/oak.hpp#L28
   */
  oak_EncoderConfig_Profile_H264_HIGH: AugmentedModule['gapi_oak_EncoderConfig_Profile_H264_HIGH']
/**
   * Encoding profile, H264, H265 or MJPEG
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/oak/oak.hpp#L28
   */
  oak_ENCODER_CONFIG_PROFILE_H264_HIGH: AugmentedModule['gapi_oak_ENCODER_CONFIG_PROFILE_H264_HIGH']
/**
   * Encoding profile, H264, H265 or MJPEG
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/oak/oak.hpp#L28
   */
  oak_EncoderConfig_Profile_H264_MAIN: AugmentedModule['gapi_oak_EncoderConfig_Profile_H264_MAIN']
/**
   * Encoding profile, H264, H265 or MJPEG
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/oak/oak.hpp#L28
   */
  oak_ENCODER_CONFIG_PROFILE_H264_MAIN: AugmentedModule['gapi_oak_ENCODER_CONFIG_PROFILE_H264_MAIN']
/**
   * Encoding profile, H264, H265 or MJPEG
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/oak/oak.hpp#L28
   */
  oak_EncoderConfig_Profile_H265_MAIN: AugmentedModule['gapi_oak_EncoderConfig_Profile_H265_MAIN']
/**
   * Encoding profile, H264, H265 or MJPEG
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/oak/oak.hpp#L28
   */
  oak_ENCODER_CONFIG_PROFILE_H265_MAIN: AugmentedModule['gapi_oak_ENCODER_CONFIG_PROFILE_H265_MAIN']
/**
   * Encoding profile, H264, H265 or MJPEG
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/oak/oak.hpp#L28
   */
  oak_EncoderConfig_Profile_MJPEG: AugmentedModule['gapi_oak_EncoderConfig_Profile_MJPEG']
/**
   * Encoding profile, H264, H265 or MJPEG
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/oak/oak.hpp#L28
   */
  oak_ENCODER_CONFIG_PROFILE_MJPEG: AugmentedModule['gapi_oak_ENCODER_CONFIG_PROFILE_MJPEG']
/**
   * gapi_oak_ColorCameraParams_BoardSocket_RGB: FIXME: extend
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/oak/oak.hpp#L121
   */
  oak_ColorCameraParams_BoardSocket_RGB: AugmentedModule['gapi_oak_ColorCameraParams_BoardSocket_RGB']
/**
   * gapi_oak_COLOR_CAMERA_PARAMS_BOARD_SOCKET_RGB: FIXME: extend
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/oak/oak.hpp#L121
   */
  oak_COLOR_CAMERA_PARAMS_BOARD_SOCKET_RGB: AugmentedModule['gapi_oak_COLOR_CAMERA_PARAMS_BOARD_SOCKET_RGB']
/**
   * gapi_oak_ColorCameraParams_BoardSocket_BGR: FIXME: extend
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/oak/oak.hpp#L121
   */
  oak_ColorCameraParams_BoardSocket_BGR: AugmentedModule['gapi_oak_ColorCameraParams_BoardSocket_BGR']
/**
   * gapi_oak_COLOR_CAMERA_PARAMS_BOARD_SOCKET_BGR: FIXME: extend
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/oak/oak.hpp#L121
   */
  oak_COLOR_CAMERA_PARAMS_BOARD_SOCKET_BGR: AugmentedModule['gapi_oak_COLOR_CAMERA_PARAMS_BOARD_SOCKET_BGR']
/**
   * gapi_oak_ColorCameraParams_Resolution_THE_1080_P: FIXME: extend
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/oak/oak.hpp#L126
   */
  oak_ColorCameraParams_Resolution_THE_1080_P: AugmentedModule['gapi_oak_ColorCameraParams_Resolution_THE_1080_P']
/**
   * gapi_oak_COLOR_CAMERA_PARAMS_RESOLUTION_THE_1080_P: FIXME: extend
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/oak/oak.hpp#L126
   */
  oak_COLOR_CAMERA_PARAMS_RESOLUTION_THE_1080_P: AugmentedModule['gapi_oak_COLOR_CAMERA_PARAMS_RESOLUTION_THE_1080_P']
/**
   * enum: TrackingStatus
   *
   * Tracking status twin for vas::ot::TrackingStatus
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/ot.hpp#L27
   */
  ot_TrackingStatus: AugmentedModule['gapi_ot_TrackingStatus']
/**
   * The object is newly added.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/ot.hpp#L29
   */
  ot_NEW: AugmentedModule['gapi_ot_NEW']
/**
   * The object is being tracked.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/ot.hpp#L30
   */
  ot_TRACKED: AugmentedModule['gapi_ot_TRACKED']
/**
   * The object gets lost now. The object can be tracked again
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/ot.hpp#L31
   */
  ot_LOST: AugmentedModule['gapi_ot_LOST']
/**
   * gapi own detail mat header auto step constant (0), defined by OpenCV for cv::gapi::own::detail::MatHeader.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/own/mat.hpp#L45
   */
  own_detail_MatHeader_AUTO_STEP: AugmentedModule['gapi_own_detail_MatHeader_AUTO_STEP']
/**
   * gapi own detail mat header auto step constant (0), defined by OpenCV for cv::gapi::own::detail::MatHeader.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/own/mat.hpp#L45
   */
  own_detail_MAT_HEADER_AUTO_STEP: AugmentedModule['gapi_own_detail_MAT_HEADER_AUTO_STEP']
/**
   * gapi own detail mat header type mask constant (0x00000FFF), defined by OpenCV for cv::gapi::own::detail::MatHeader.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/own/mat.hpp#L46
   */
  own_detail_MatHeader_TYPE_MASK: AugmentedModule['gapi_own_detail_MatHeader_TYPE_MASK']
/**
   * gapi own detail mat header type mask constant (0x00000FFF), defined by OpenCV for cv::gapi::own::detail::MatHeader.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/own/mat.hpp#L46
   */
  own_detail_MAT_HEADER_TYPE_MASK: AugmentedModule['gapi_own_detail_MAT_HEADER_TYPE_MASK']
/**
   * Indicates what type of data should be produced by GStreamerSource: cv::MediaFrame or cv::Mat
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/streaming/gstreamer/gstreamersource.hpp#L58
   */
  wip_gst_GStreamerSource_OutputType: AugmentedModule['gapi_wip_gst_GStreamerSource_OutputType']
/**
   * gapi wip gst gstreamer source output type frame constant (0), defined by OpenCV for cv::gapi::wip::gst::GStreamerSource::OutputType.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/streaming/gstreamer/gstreamersource.hpp#L59
   */
  wip_gst_GStreamerSource_OutputType_FRAME: AugmentedModule['gapi_wip_gst_GStreamerSource_OutputType_FRAME']
/**
   * gapi wip gst gstreamer source output type frame constant (0), defined by OpenCV for cv::gapi::wip::gst::GStreamerSource::OutputType.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/streaming/gstreamer/gstreamersource.hpp#L59
   */
  wip_gst_GSTREAMER_SOURCE_OUTPUT_TYPE_FRAME: AugmentedModule['gapi_wip_gst_GSTREAMER_SOURCE_OUTPUT_TYPE_FRAME']
/**
   * gapi wip gst gstreamer source output type mat constant (1), defined by OpenCV for cv::gapi::wip::gst::GStreamerSource::OutputType.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/streaming/gstreamer/gstreamersource.hpp#L60
   */
  wip_gst_GStreamerSource_OutputType_MAT: AugmentedModule['gapi_wip_gst_GStreamerSource_OutputType_MAT']
/**
   * gapi wip gst gstreamer source output type mat constant (1), defined by OpenCV for cv::gapi::wip::gst::GStreamerSource::OutputType.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/streaming/gstreamer/gstreamersource.hpp#L60
   */
  wip_gst_GSTREAMER_SOURCE_OUTPUT_TYPE_MAT: AugmentedModule['gapi_wip_gst_GSTREAMER_SOURCE_OUTPUT_TYPE_MAT']
/**
   * Native enum entries for gapi wip onevpl accel type. Pass an entry to enum-typed arguments or its .value to numeric arguments.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/streaming/onevpl/accel_types.hpp#L20
   */
  wip_onevpl_AccelType: AugmentedModule['gapi_wip_onevpl_AccelType']
/**
   * gapi wip onevpl accel type host constant (0), defined by OpenCV for cv::gapi::wip::onevpl::AccelType.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/streaming/onevpl/accel_types.hpp#L21
   */
  wip_onevpl_AccelType_HOST: AugmentedModule['gapi_wip_onevpl_AccelType_HOST']
/**
   * gapi wip onevpl accel type host constant (0), defined by OpenCV for cv::gapi::wip::onevpl::AccelType.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/streaming/onevpl/accel_types.hpp#L21
   */
  wip_onevpl_ACCEL_TYPE_HOST: AugmentedModule['gapi_wip_onevpl_ACCEL_TYPE_HOST']
/**
   * gapi wip onevpl accel type dx11 constant (1), defined by OpenCV for cv::gapi::wip::onevpl::AccelType.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/streaming/onevpl/accel_types.hpp#L22
   */
  wip_onevpl_AccelType_DX11: AugmentedModule['gapi_wip_onevpl_AccelType_DX11']
/**
   * gapi wip onevpl accel type dx11 constant (1), defined by OpenCV for cv::gapi::wip::onevpl::AccelType.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/streaming/onevpl/accel_types.hpp#L22
   */
  wip_onevpl_ACCEL_TYPE_DX11: AugmentedModule['gapi_wip_onevpl_ACCEL_TYPE_DX11']
/**
   * gapi wip onevpl accel type vaapi constant (2), defined by OpenCV for cv::gapi::wip::onevpl::AccelType.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/streaming/onevpl/accel_types.hpp#L23
   */
  wip_onevpl_AccelType_VAAPI: AugmentedModule['gapi_wip_onevpl_AccelType_VAAPI']
/**
   * gapi wip onevpl accel type vaapi constant (2), defined by OpenCV for cv::gapi::wip::onevpl::AccelType.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/streaming/onevpl/accel_types.hpp#L23
   */
  wip_onevpl_ACCEL_TYPE_VAAPI: AugmentedModule['gapi_wip_onevpl_ACCEL_TYPE_VAAPI']
/**
   * gapi wip onevpl accel type last value constant (std::numeric_limits<uint8_t>::max()), defined by OpenCV for cv::gapi::wip::onevpl::AccelType.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/streaming/onevpl/accel_types.hpp#L25
   */
  wip_onevpl_AccelType_LAST_VALUE: AugmentedModule['gapi_wip_onevpl_AccelType_LAST_VALUE']
/**
   * gapi wip onevpl accel type last value constant (std::numeric_limits<uint8_t>::max()), defined by OpenCV for cv::gapi::wip::onevpl::AccelType.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/streaming/onevpl/accel_types.hpp#L25
   */
  wip_onevpl_ACCEL_TYPE_LAST_VALUE: AugmentedModule['gapi_wip_onevpl_ACCEL_TYPE_LAST_VALUE']
/**
   * This namespace contains G-API Operations and functions for
   * video-oriented algorithms, like optical flow and background subtraction.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/video.hpp#L96
   */
  video_BackgroundSubtractorType: AugmentedModule['gapi_video_BackgroundSubtractorType']
/**
   * gapi video type bs mog2 constant (0), defined by OpenCV for cv::gapi::video.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/video.hpp#L98
   */
  video_TYPE_BS_MOG2: AugmentedModule['gapi_video_TYPE_BS_MOG2']
/**
   * gapi video type bs knn constant (1), defined by OpenCV for cv::gapi::video.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/video.hpp#L99
   */
  video_TYPE_BS_KNN: AugmentedModule['gapi_video_TYPE_BS_KNN']
/**
   * gapi cv bool value in the OpenCV API.
   */
  CV_BOOL: AugmentedModule['gapi_CV_BOOL']
/**
   * gapi cv int value in the OpenCV API.
   */
  CV_INT: AugmentedModule['gapi_CV_INT']
/**
   * gapi cv int64 value in the OpenCV API.
   */
  CV_INT64: AugmentedModule['gapi_CV_INT64']
/**
   * gapi cv uint64 value in the OpenCV API.
   */
  CV_UINT64: AugmentedModule['gapi_CV_UINT64']
/**
   * gapi cv double value in the OpenCV API.
   */
  CV_DOUBLE: AugmentedModule['gapi_CV_DOUBLE']
/**
   * gapi cv float value in the OpenCV API.
   */
  CV_FLOAT: AugmentedModule['gapi_CV_FLOAT']
/**
   * gapi cv string value in the OpenCV API.
   */
  CV_STRING: AugmentedModule['gapi_CV_STRING']
/**
   * gapi cv point value in the OpenCV API.
   */
  CV_POINT: AugmentedModule['gapi_CV_POINT']
/**
   * gapi cv point2 f value in the OpenCV API.
   */
  CV_POINT2F: AugmentedModule['gapi_CV_POINT2F']
/**
   * gapi cv point3 f value in the OpenCV API.
   */
  CV_POINT3F: AugmentedModule['gapi_CV_POINT3F']
/**
   * gapi cv size value in the OpenCV API.
   */
  CV_SIZE: AugmentedModule['gapi_CV_SIZE']
/**
   * gapi cv rect value in the OpenCV API.
   */
  CV_RECT: AugmentedModule['gapi_CV_RECT']
/**
   * gapi cv scalar value in the OpenCV API.
   */
  CV_SCALAR: AugmentedModule['gapi_CV_SCALAR']
/**
   * gapi cv mat value in the OpenCV API.
   */
  CV_MAT: AugmentedModule['gapi_CV_MAT']
/**
   * gapi cv gmat value in the OpenCV API.
   */
  CV_GMAT: AugmentedModule['gapi_CV_GMAT']
/**
   * gapi cv draw prim value in the OpenCV API.
   */
  CV_DRAW_PRIM: AugmentedModule['gapi_CV_DRAW_PRIM']
/**
   * gapi cv any value in the OpenCV API.
   */
  CV_ANY: AugmentedModule['gapi_CV_ANY']
  /** Native gapi.core namespace. */
  core: CVNamespace<'gapi_core'> & {
  /** Native gapi.core.cpu namespace. */
  cpu: CVNamespace<'gapi_core_cpu'> & {

}
  /** Native gapi.core.fluid namespace. */
  fluid: CVNamespace<'gapi_core_fluid'> & {

}
  /** Native gapi.core.ocl namespace. */
  ocl: CVNamespace<'gapi_core_ocl'> & {

}
}
  /** Native gapi.dnn namespace. */
  dnn: CVNamespace<'gapi_dnn'> & {
/**
   * Configuration for a named OpenCV DNN graph network. Retains the supplied Net and selects its CPU backend. Configure image preprocessing before packaging with `cv.gapi.networks`.
   */
  Params: AugmentedModule['gapi_dnn_Params']
}
  /** Native gapi.ie namespace. */
  ie: CVNamespace<'gapi_ie'> & {
/**
   * NB: Used by python wrapper
   * This class can be marked as SIMPLE, because it's implemented as pimpl
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/infer/bindings_ie.hpp#L23
   */
  PyParams: AugmentedModule['gapi_ie_PyParams']
/**
   * Specifies how G-API and IE should trait input data
   *
   * In OpenCV, the same cv::Mat is used to represent both
   * image and tensor data. Sometimes those are hardly distinguishable,
   * so this extra parameter is used to give G-API a hint.
   *
   * This hint controls how G-API reinterprets the data when converting
   * it to IE Blob format (and which layout/etc is assigned to this data).
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/infer/ie.hpp#L47
   */
  TraitAs: AugmentedModule['gapi_ie_TraitAs']
/**
   * Native enum entries for gapi ie infer mode. Pass an entry to enum-typed arguments or its .value to numeric arguments.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/infer/ie.hpp#L55
   */
  InferMode: AugmentedModule['gapi_ie_InferMode']
/**
   * G-API traits an associated cv::Mat as a raw tensor and passes dimensions as-is
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/infer/ie.hpp#L49
   */
  TraitAs_TENSOR: AugmentedModule['gapi_ie_TraitAs_TENSOR']
/**
   * G-API traits an associated cv::Mat as a raw tensor and passes dimensions as-is
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/infer/ie.hpp#L49
   */
  TRAIT_AS_TENSOR: AugmentedModule['gapi_ie_TRAIT_AS_TENSOR']
/**
   * G-API traits an associated cv::Mat as an image so creates an "image" blob (NCHW/NHWC, etc)
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/infer/ie.hpp#L50
   */
  TraitAs_IMAGE: AugmentedModule['gapi_ie_TraitAs_IMAGE']
/**
   * G-API traits an associated cv::Mat as an image so creates an "image" blob (NCHW/NHWC, etc)
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/infer/ie.hpp#L50
   */
  TRAIT_AS_IMAGE: AugmentedModule['gapi_ie_TRAIT_AS_IMAGE']
/**
   * gapi ie sync constant (0), defined by OpenCV for cv::gapi::ie.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/infer/ie.hpp#L55
   */
  Sync: AugmentedModule['gapi_ie_Sync']
/**
   * gapi ie sync constant (0), defined by OpenCV for cv::gapi::ie.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/infer/ie.hpp#L55
   */
  SYNC: AugmentedModule['gapi_ie_SYNC']
/**
   * gapi ie async constant (1), defined by OpenCV for cv::gapi::ie.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/infer/ie.hpp#L55
   */
  Async: AugmentedModule['gapi_ie_Async']
/**
   * gapi ie async constant (1), defined by OpenCV for cv::gapi::ie.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/infer/ie.hpp#L55
   */
  ASYNC: AugmentedModule['gapi_ie_ASYNC']
/**
   * Native enum entries for gapi ie detail param desc kind. Pass an entry to enum-typed arguments or its .value to numeric arguments.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/infer/ie.hpp#L87
   */
  detail_ParamDesc_Kind: AugmentedModule['gapi_ie_detail_ParamDesc_Kind']
/**
   * gapi ie detail param desc kind load constant (0), defined by OpenCV for cv::gapi::ie::detail::ParamDesc::Kind.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/infer/ie.hpp#L87
   */
  detail_ParamDesc_Kind_Load: AugmentedModule['gapi_ie_detail_ParamDesc_Kind_Load']
/**
   * gapi ie detail param desc kind load constant (0), defined by OpenCV for cv::gapi::ie::detail::ParamDesc::Kind.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/infer/ie.hpp#L87
   */
  detail_PARAM_DESC_KIND_LOAD: AugmentedModule['gapi_ie_detail_PARAM_DESC_KIND_LOAD']
/**
   * gapi ie detail param desc kind import constant (1), defined by OpenCV for cv::gapi::ie::detail::ParamDesc::Kind.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/infer/ie.hpp#L87
   */
  detail_ParamDesc_Kind_Import: AugmentedModule['gapi_ie_detail_ParamDesc_Kind_Import']
/**
   * gapi ie detail param desc kind import constant (1), defined by OpenCV for cv::gapi::ie::detail::ParamDesc::Kind.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/infer/ie.hpp#L87
   */
  detail_PARAM_DESC_KIND_IMPORT: AugmentedModule['gapi_ie_detail_PARAM_DESC_KIND_IMPORT']
  /** Native gapi.ie.detail namespace. */
  detail: CVNamespace<'gapi_ie_detail'> & {
/**
   * Native enum entries for gapi ie detail param desc kind. Pass an entry to enum-typed arguments or its .value to numeric arguments.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/infer/ie.hpp#L87
   */
  ParamDesc_Kind: AugmentedModule['gapi_ie_detail_ParamDesc_Kind']
/**
   * gapi ie detail param desc kind load constant (0), defined by OpenCV for cv::gapi::ie::detail::ParamDesc::Kind.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/infer/ie.hpp#L87
   */
  ParamDesc_Kind_Load: AugmentedModule['gapi_ie_detail_ParamDesc_Kind_Load']
/**
   * gapi ie detail param desc kind load constant (0), defined by OpenCV for cv::gapi::ie::detail::ParamDesc::Kind.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/infer/ie.hpp#L87
   */
  PARAM_DESC_KIND_LOAD: AugmentedModule['gapi_ie_detail_PARAM_DESC_KIND_LOAD']
/**
   * gapi ie detail param desc kind import constant (1), defined by OpenCV for cv::gapi::ie::detail::ParamDesc::Kind.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/infer/ie.hpp#L87
   */
  ParamDesc_Kind_Import: AugmentedModule['gapi_ie_detail_ParamDesc_Kind_Import']
/**
   * gapi ie detail param desc kind import constant (1), defined by OpenCV for cv::gapi::ie::detail::ParamDesc::Kind.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/infer/ie.hpp#L87
   */
  PARAM_DESC_KIND_IMPORT: AugmentedModule['gapi_ie_detail_PARAM_DESC_KIND_IMPORT']
}
}
  /** Native gapi.imgproc namespace. */
  imgproc: CVNamespace<'gapi_imgproc'> & {
  /** Native gapi.imgproc.fluid namespace. */
  fluid: CVNamespace<'gapi_imgproc_fluid'> & {

}
}
  /** Native gapi.oak namespace. */
  oak: CVNamespace<'gapi_oak'> & {
/**
   * Rate control mode specifies if constant or variable bitrate should be used (H264 / H265)
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/oak/oak.hpp#L23
   */
  EncoderConfig_RateControlMode: AugmentedModule['gapi_oak_EncoderConfig_RateControlMode']
/**
   * Encoding profile, H264, H265 or MJPEG
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/oak/oak.hpp#L28
   */
  EncoderConfig_Profile: AugmentedModule['gapi_oak_EncoderConfig_Profile']
/**
   * gapi_oak_ColorCameraParams_BoardSocket: FIXME: extend
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/oak/oak.hpp#L121
   */
  ColorCameraParams_BoardSocket: AugmentedModule['gapi_oak_ColorCameraParams_BoardSocket']
/**
   * gapi_oak_ColorCameraParams_Resolution: FIXME: extend
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/oak/oak.hpp#L126
   */
  ColorCameraParams_Resolution: AugmentedModule['gapi_oak_ColorCameraParams_Resolution']
/**
   * Rate control mode specifies if constant or variable bitrate should be used (H264 / H265)
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/oak/oak.hpp#L23
   */
  EncoderConfig_RateControlMode_CBR: AugmentedModule['gapi_oak_EncoderConfig_RateControlMode_CBR']
/**
   * Rate control mode specifies if constant or variable bitrate should be used (H264 / H265)
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/oak/oak.hpp#L23
   */
  ENCODER_CONFIG_RATE_CONTROL_MODE_CBR: AugmentedModule['gapi_oak_ENCODER_CONFIG_RATE_CONTROL_MODE_CBR']
/**
   * Rate control mode specifies if constant or variable bitrate should be used (H264 / H265)
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/oak/oak.hpp#L23
   */
  EncoderConfig_RateControlMode_VBR: AugmentedModule['gapi_oak_EncoderConfig_RateControlMode_VBR']
/**
   * Rate control mode specifies if constant or variable bitrate should be used (H264 / H265)
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/oak/oak.hpp#L23
   */
  ENCODER_CONFIG_RATE_CONTROL_MODE_VBR: AugmentedModule['gapi_oak_ENCODER_CONFIG_RATE_CONTROL_MODE_VBR']
/**
   * Encoding profile, H264, H265 or MJPEG
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/oak/oak.hpp#L28
   */
  EncoderConfig_Profile_H264_BASELINE: AugmentedModule['gapi_oak_EncoderConfig_Profile_H264_BASELINE']
/**
   * Encoding profile, H264, H265 or MJPEG
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/oak/oak.hpp#L28
   */
  ENCODER_CONFIG_PROFILE_H264_BASELINE: AugmentedModule['gapi_oak_ENCODER_CONFIG_PROFILE_H264_BASELINE']
/**
   * Encoding profile, H264, H265 or MJPEG
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/oak/oak.hpp#L28
   */
  EncoderConfig_Profile_H264_HIGH: AugmentedModule['gapi_oak_EncoderConfig_Profile_H264_HIGH']
/**
   * Encoding profile, H264, H265 or MJPEG
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/oak/oak.hpp#L28
   */
  ENCODER_CONFIG_PROFILE_H264_HIGH: AugmentedModule['gapi_oak_ENCODER_CONFIG_PROFILE_H264_HIGH']
/**
   * Encoding profile, H264, H265 or MJPEG
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/oak/oak.hpp#L28
   */
  EncoderConfig_Profile_H264_MAIN: AugmentedModule['gapi_oak_EncoderConfig_Profile_H264_MAIN']
/**
   * Encoding profile, H264, H265 or MJPEG
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/oak/oak.hpp#L28
   */
  ENCODER_CONFIG_PROFILE_H264_MAIN: AugmentedModule['gapi_oak_ENCODER_CONFIG_PROFILE_H264_MAIN']
/**
   * Encoding profile, H264, H265 or MJPEG
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/oak/oak.hpp#L28
   */
  EncoderConfig_Profile_H265_MAIN: AugmentedModule['gapi_oak_EncoderConfig_Profile_H265_MAIN']
/**
   * Encoding profile, H264, H265 or MJPEG
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/oak/oak.hpp#L28
   */
  ENCODER_CONFIG_PROFILE_H265_MAIN: AugmentedModule['gapi_oak_ENCODER_CONFIG_PROFILE_H265_MAIN']
/**
   * Encoding profile, H264, H265 or MJPEG
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/oak/oak.hpp#L28
   */
  EncoderConfig_Profile_MJPEG: AugmentedModule['gapi_oak_EncoderConfig_Profile_MJPEG']
/**
   * Encoding profile, H264, H265 or MJPEG
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/oak/oak.hpp#L28
   */
  ENCODER_CONFIG_PROFILE_MJPEG: AugmentedModule['gapi_oak_ENCODER_CONFIG_PROFILE_MJPEG']
/**
   * gapi_oak_ColorCameraParams_BoardSocket_RGB: FIXME: extend
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/oak/oak.hpp#L121
   */
  ColorCameraParams_BoardSocket_RGB: AugmentedModule['gapi_oak_ColorCameraParams_BoardSocket_RGB']
/**
   * gapi_oak_COLOR_CAMERA_PARAMS_BOARD_SOCKET_RGB: FIXME: extend
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/oak/oak.hpp#L121
   */
  COLOR_CAMERA_PARAMS_BOARD_SOCKET_RGB: AugmentedModule['gapi_oak_COLOR_CAMERA_PARAMS_BOARD_SOCKET_RGB']
/**
   * gapi_oak_ColorCameraParams_BoardSocket_BGR: FIXME: extend
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/oak/oak.hpp#L121
   */
  ColorCameraParams_BoardSocket_BGR: AugmentedModule['gapi_oak_ColorCameraParams_BoardSocket_BGR']
/**
   * gapi_oak_COLOR_CAMERA_PARAMS_BOARD_SOCKET_BGR: FIXME: extend
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/oak/oak.hpp#L121
   */
  COLOR_CAMERA_PARAMS_BOARD_SOCKET_BGR: AugmentedModule['gapi_oak_COLOR_CAMERA_PARAMS_BOARD_SOCKET_BGR']
/**
   * gapi_oak_ColorCameraParams_Resolution_THE_1080_P: FIXME: extend
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/oak/oak.hpp#L126
   */
  ColorCameraParams_Resolution_THE_1080_P: AugmentedModule['gapi_oak_ColorCameraParams_Resolution_THE_1080_P']
/**
   * gapi_oak_COLOR_CAMERA_PARAMS_RESOLUTION_THE_1080_P: FIXME: extend
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/oak/oak.hpp#L126
   */
  COLOR_CAMERA_PARAMS_RESOLUTION_THE_1080_P: AugmentedModule['gapi_oak_COLOR_CAMERA_PARAMS_RESOLUTION_THE_1080_P']
}
  /** Native gapi.onnx namespace. */
  onnx: CVNamespace<'gapi_onnx'> & {
/**
   * NB: Used by python wrapper
   * This class can be marked as SIMPLE, because it's implemented as pimpl
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/infer/bindings_onnx.hpp#L21
   */
  PyParams: AugmentedModule['gapi_onnx_PyParams']
/**
   * This structure provides functions
   * that fill inference options for ONNX CoreML Execution Provider.
   * Please follow https://onnxruntime.ai/docs/execution-providers/CoreML-ExecutionProvider.html#coreml-execution-provider
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/infer/onnx.hpp#L43
   */
  ep_CoreML: AugmentedModule['gapi_onnx_ep_CoreML']
/**
   * This structure provides functions
   * that fill inference options for CUDA Execution Provider.
   * Please follow https://onnxruntime.ai/docs/execution-providers/CUDA-ExecutionProvider.html#cuda-execution-provider
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/infer/onnx.hpp#L102
   */
  ep_CUDA: AugmentedModule['gapi_onnx_ep_CUDA']
/**
   * This structure provides functions
   * that fill inference options for TensorRT Execution Provider.
   * Please follow https://onnxruntime.ai/docs/execution-providers/TensorRT-ExecutionProvider.html#tensorrt-execution-provider
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/infer/onnx.hpp#L127
   */
  ep_TensorRT: AugmentedModule['gapi_onnx_ep_TensorRT']
/**
   * This structure provides functions
   * that fill inference options for ONNX OpenVINO Execution Provider.
   * Please follow https://onnxruntime.ai/docs/execution-providers/OpenVINO-ExecutionProvider.html#summary-of-options
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/infer/onnx.hpp#L152
   */
  ep_OpenVINO: AugmentedModule['gapi_onnx_ep_OpenVINO']
/**
   * This structure provides functions
   * that fill inference options for ONNX DirectML Execution Provider.
   * Please follow https://onnxruntime.ai/docs/execution-providers/DirectML-ExecutionProvider.html#directml-execution-provider
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/infer/onnx.hpp#L266
   */
  ep_DirectML: AugmentedModule['gapi_onnx_ep_DirectML']
/**
   * Native enum entries for gapi onnx trait as. Pass an entry to enum-typed arguments or its .value to numeric arguments.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/infer/onnx.hpp#L306
   */
  TraitAs: AugmentedModule['gapi_onnx_TraitAs']
/**
   * G-API traits an associated cv::Mat as a raw tensor
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/infer/onnx.hpp#L307
   */
  TraitAs_TENSOR: AugmentedModule['gapi_onnx_TraitAs_TENSOR']
/**
   * G-API traits an associated cv::Mat as a raw tensor
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/infer/onnx.hpp#L307
   */
  TRAIT_AS_TENSOR: AugmentedModule['gapi_onnx_TRAIT_AS_TENSOR']
/**
   * G-API traits an associated cv::Mat as an image so
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/infer/onnx.hpp#L309
   */
  TraitAs_IMAGE: AugmentedModule['gapi_onnx_TraitAs_IMAGE']
/**
   * G-API traits an associated cv::Mat as an image so
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/infer/onnx.hpp#L309
   */
  TRAIT_AS_IMAGE: AugmentedModule['gapi_onnx_TRAIT_AS_IMAGE']
  /** Native gapi.onnx.ep namespace. */
  ep: CVNamespace<'gapi_onnx_ep'> & {
/**
   * This structure provides functions
   * that fill inference options for ONNX CoreML Execution Provider.
   * Please follow https://onnxruntime.ai/docs/execution-providers/CoreML-ExecutionProvider.html#coreml-execution-provider
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/infer/onnx.hpp#L43
   */
  CoreML: AugmentedModule['gapi_onnx_ep_CoreML']
/**
   * This structure provides functions
   * that fill inference options for CUDA Execution Provider.
   * Please follow https://onnxruntime.ai/docs/execution-providers/CUDA-ExecutionProvider.html#cuda-execution-provider
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/infer/onnx.hpp#L102
   */
  CUDA: AugmentedModule['gapi_onnx_ep_CUDA']
/**
   * This structure provides functions
   * that fill inference options for TensorRT Execution Provider.
   * Please follow https://onnxruntime.ai/docs/execution-providers/TensorRT-ExecutionProvider.html#tensorrt-execution-provider
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/infer/onnx.hpp#L127
   */
  TensorRT: AugmentedModule['gapi_onnx_ep_TensorRT']
/**
   * This structure provides functions
   * that fill inference options for ONNX OpenVINO Execution Provider.
   * Please follow https://onnxruntime.ai/docs/execution-providers/OpenVINO-ExecutionProvider.html#summary-of-options
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/infer/onnx.hpp#L152
   */
  OpenVINO: AugmentedModule['gapi_onnx_ep_OpenVINO']
/**
   * This structure provides functions
   * that fill inference options for ONNX DirectML Execution Provider.
   * Please follow https://onnxruntime.ai/docs/execution-providers/DirectML-ExecutionProvider.html#directml-execution-provider
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/infer/onnx.hpp#L266
   */
  DirectML: AugmentedModule['gapi_onnx_ep_DirectML']
}
}
  /** Native gapi.ot namespace. */
  ot: CVNamespace<'gapi_ot'> & {
/**
   * gapi ot object tracker params value in the OpenCV API.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/ot.hpp#L35
   */
  ObjectTrackerParams: AugmentedModule['gapi_ot_ObjectTrackerParams']
/**
   * enum: TrackingStatus
   *
   * Tracking status twin for vas::ot::TrackingStatus
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/ot.hpp#L27
   */
  TrackingStatus: AugmentedModule['gapi_ot_TrackingStatus']
/**
   * The object is newly added.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/ot.hpp#L29
   */
  NEW: AugmentedModule['gapi_ot_NEW']
/**
   * The object is being tracked.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/ot.hpp#L30
   */
  TRACKED: AugmentedModule['gapi_ot_TRACKED']
/**
   * The object gets lost now. The object can be tracked again
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/ot.hpp#L31
   */
  LOST: AugmentedModule['gapi_ot_LOST']
  /** Native gapi.ot.cpu namespace. */
  cpu: CVNamespace<'gapi_ot_cpu'> & {

}
}
  /** Native gapi.ov namespace. */
  ov: CVNamespace<'gapi_ov'> & {
/**
   * NB: Used by python wrapper
   * This class can be marked as SIMPLE, because it's implemented as pimpl
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/infer/bindings_ov.hpp#L23
   */
  PyParams: AugmentedModule['gapi_ov_PyParams']
}
  /** Native gapi.own namespace. */
  own: CVNamespace<'gapi_own'> & {
/**
   * gapi own detail mat header auto step constant (0), defined by OpenCV for cv::gapi::own::detail::MatHeader.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/own/mat.hpp#L45
   */
  detail_MatHeader_AUTO_STEP: AugmentedModule['gapi_own_detail_MatHeader_AUTO_STEP']
/**
   * gapi own detail mat header auto step constant (0), defined by OpenCV for cv::gapi::own::detail::MatHeader.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/own/mat.hpp#L45
   */
  detail_MAT_HEADER_AUTO_STEP: AugmentedModule['gapi_own_detail_MAT_HEADER_AUTO_STEP']
/**
   * gapi own detail mat header type mask constant (0x00000FFF), defined by OpenCV for cv::gapi::own::detail::MatHeader.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/own/mat.hpp#L46
   */
  detail_MatHeader_TYPE_MASK: AugmentedModule['gapi_own_detail_MatHeader_TYPE_MASK']
/**
   * gapi own detail mat header type mask constant (0x00000FFF), defined by OpenCV for cv::gapi::own::detail::MatHeader.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/own/mat.hpp#L46
   */
  detail_MAT_HEADER_TYPE_MASK: AugmentedModule['gapi_own_detail_MAT_HEADER_TYPE_MASK']
  /** Native gapi.own.detail namespace. */
  detail: CVNamespace<'gapi_own_detail'> & {
/**
   * gapi own detail mat header auto step constant (0), defined by OpenCV for cv::gapi::own::detail::MatHeader.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/own/mat.hpp#L45
   */
  MatHeader_AUTO_STEP: AugmentedModule['gapi_own_detail_MatHeader_AUTO_STEP']
/**
   * gapi own detail mat header auto step constant (0), defined by OpenCV for cv::gapi::own::detail::MatHeader.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/own/mat.hpp#L45
   */
  MAT_HEADER_AUTO_STEP: AugmentedModule['gapi_own_detail_MAT_HEADER_AUTO_STEP']
/**
   * gapi own detail mat header type mask constant (0x00000FFF), defined by OpenCV for cv::gapi::own::detail::MatHeader.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/own/mat.hpp#L46
   */
  MatHeader_TYPE_MASK: AugmentedModule['gapi_own_detail_MatHeader_TYPE_MASK']
/**
   * gapi own detail mat header type mask constant (0x00000FFF), defined by OpenCV for cv::gapi::own::detail::MatHeader.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/own/mat.hpp#L46
   */
  MAT_HEADER_TYPE_MASK: AugmentedModule['gapi_own_detail_MAT_HEADER_TYPE_MASK']
}
}
  /** Native gapi.render namespace. */
  render: CVNamespace<'gapi_render'> & {
  /** Native gapi.render.ocv namespace. */
  ocv: CVNamespace<'gapi_render_ocv'> & {

}
}
  /** Native gapi.streaming namespace. */
  streaming: CVNamespace<'gapi_streaming'> & {
/**
   * Specify queue capacity for streaming execution.
   *
   * In the streaming mode the pipeline steps are connected with queues
   * and this compile argument controls every queue's size.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/gstreaming.hpp#L408
   */
  queue_capacity: AugmentedModule['gapi_streaming_queue_capacity']
/**
   * Native enum entries for gapi streaming sync policy. Pass an entry to enum-typed arguments or its .value to numeric arguments.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/streaming/sync.hpp#L14
   */
  sync_policy: AugmentedModule['gapi_streaming_sync_policy']
/**
   * gapi streaming sync policy dont sync constant (0), defined by OpenCV for cv::gapi::streaming::sync_policy.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/streaming/sync.hpp#L15
   */
  sync_policy_dont_sync: AugmentedModule['gapi_streaming_sync_policy_dont_sync']
/**
   * gapi streaming sync policy dont sync constant (0), defined by OpenCV for cv::gapi::streaming::sync_policy.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/streaming/sync.hpp#L15
   */
  SYNC_POLICY_DONT_SYNC: AugmentedModule['gapi_streaming_SYNC_POLICY_DONT_SYNC']
/**
   * gapi streaming sync policy drop constant (1), defined by OpenCV for cv::gapi::streaming::sync_policy.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/streaming/sync.hpp#L16
   */
  sync_policy_drop: AugmentedModule['gapi_streaming_sync_policy_drop']
/**
   * gapi streaming sync policy drop constant (1), defined by OpenCV for cv::gapi::streaming::sync_policy.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/streaming/sync.hpp#L16
   */
  SYNC_POLICY_DROP: AugmentedModule['gapi_streaming_SYNC_POLICY_DROP']
}
  /** Native gapi.video namespace. */
  video: CVNamespace<'gapi_video'> & {
/**
   * This namespace contains G-API Operations and functions for
   * video-oriented algorithms, like optical flow and background subtraction.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/video.hpp#L96
   */
  BackgroundSubtractorType: AugmentedModule['gapi_video_BackgroundSubtractorType']
/**
   * gapi video type bs mog2 constant (0), defined by OpenCV for cv::gapi::video.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/video.hpp#L98
   */
  TYPE_BS_MOG2: AugmentedModule['gapi_video_TYPE_BS_MOG2']
/**
   * gapi video type bs knn constant (1), defined by OpenCV for cv::gapi::video.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/video.hpp#L99
   */
  TYPE_BS_KNN: AugmentedModule['gapi_video_TYPE_BS_KNN']
}
  /** Native gapi.wip namespace. */
  wip: CVNamespace<'gapi_wip'> & {
/**
   * This structure represents a text string to draw.
   *
   * Parameters match cv::putText().
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/render/render_types.hpp#L44
   */
  draw_Text: AugmentedModule['gapi_wip_draw_Text']
/**
   * This structure represents a rectangle to draw.
   *
   * Parameters match cv::rectangle().
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/render/render_types.hpp#L127
   */
  draw_Rect: AugmentedModule['gapi_wip_draw_Rect']
/**
   * This structure represents a circle to draw.
   *
   * Parameters match cv::circle().
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/render/render_types.hpp#L164
   */
  draw_Circle: AugmentedModule['gapi_wip_draw_Circle']
/**
   * This structure represents a line to draw.
   *
   * Parameters match cv::line().
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/render/render_types.hpp#L205
   */
  draw_Line: AugmentedModule['gapi_wip_draw_Line']
/**
   * This structure represents a mosaicing operation.
   *
   * Mosaicing is a very basic method to obfuscate regions in the image.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/render/render_types.hpp#L246
   */
  draw_Mosaic: AugmentedModule['gapi_wip_draw_Mosaic']
/**
   * This structure represents an image to draw.
   *
   * Image is blended on a frame using the specified mask.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/render/render_types.hpp#L277
   */
  draw_Image: AugmentedModule['gapi_wip_draw_Image']
/**
   * This structure represents a polygon to draw.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/render/render_types.hpp#L307
   */
  draw_Poly: AugmentedModule['gapi_wip_draw_Poly']
/**
   * gapi wip gst gstreamer pipeline value in the OpenCV API.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/streaming/gstreamer/gstreamerpipeline.hpp#L22
   */
  gst_GStreamerPipeline: AugmentedModule['gapi_wip_gst_GStreamerPipeline']
/**
   * Indicates what type of data should be produced by GStreamerSource: cv::MediaFrame or cv::Mat
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/streaming/gstreamer/gstreamersource.hpp#L58
   */
  gst_GStreamerSource_OutputType: AugmentedModule['gapi_wip_gst_GStreamerSource_OutputType']
/**
   * gapi wip gst gstreamer source output type frame constant (0), defined by OpenCV for cv::gapi::wip::gst::GStreamerSource::OutputType.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/streaming/gstreamer/gstreamersource.hpp#L59
   */
  gst_GStreamerSource_OutputType_FRAME: AugmentedModule['gapi_wip_gst_GStreamerSource_OutputType_FRAME']
/**
   * gapi wip gst gstreamer source output type frame constant (0), defined by OpenCV for cv::gapi::wip::gst::GStreamerSource::OutputType.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/streaming/gstreamer/gstreamersource.hpp#L59
   */
  gst_GSTREAMER_SOURCE_OUTPUT_TYPE_FRAME: AugmentedModule['gapi_wip_gst_GSTREAMER_SOURCE_OUTPUT_TYPE_FRAME']
/**
   * gapi wip gst gstreamer source output type mat constant (1), defined by OpenCV for cv::gapi::wip::gst::GStreamerSource::OutputType.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/streaming/gstreamer/gstreamersource.hpp#L60
   */
  gst_GStreamerSource_OutputType_MAT: AugmentedModule['gapi_wip_gst_GStreamerSource_OutputType_MAT']
/**
   * gapi wip gst gstreamer source output type mat constant (1), defined by OpenCV for cv::gapi::wip::gst::GStreamerSource::OutputType.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/streaming/gstreamer/gstreamersource.hpp#L60
   */
  gst_GSTREAMER_SOURCE_OUTPUT_TYPE_MAT: AugmentedModule['gapi_wip_gst_GSTREAMER_SOURCE_OUTPUT_TYPE_MAT']
/**
   * Native enum entries for gapi wip onevpl accel type. Pass an entry to enum-typed arguments or its .value to numeric arguments.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/streaming/onevpl/accel_types.hpp#L20
   */
  onevpl_AccelType: AugmentedModule['gapi_wip_onevpl_AccelType']
/**
   * gapi wip onevpl accel type host constant (0), defined by OpenCV for cv::gapi::wip::onevpl::AccelType.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/streaming/onevpl/accel_types.hpp#L21
   */
  onevpl_AccelType_HOST: AugmentedModule['gapi_wip_onevpl_AccelType_HOST']
/**
   * gapi wip onevpl accel type host constant (0), defined by OpenCV for cv::gapi::wip::onevpl::AccelType.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/streaming/onevpl/accel_types.hpp#L21
   */
  onevpl_ACCEL_TYPE_HOST: AugmentedModule['gapi_wip_onevpl_ACCEL_TYPE_HOST']
/**
   * gapi wip onevpl accel type dx11 constant (1), defined by OpenCV for cv::gapi::wip::onevpl::AccelType.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/streaming/onevpl/accel_types.hpp#L22
   */
  onevpl_AccelType_DX11: AugmentedModule['gapi_wip_onevpl_AccelType_DX11']
/**
   * gapi wip onevpl accel type dx11 constant (1), defined by OpenCV for cv::gapi::wip::onevpl::AccelType.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/streaming/onevpl/accel_types.hpp#L22
   */
  onevpl_ACCEL_TYPE_DX11: AugmentedModule['gapi_wip_onevpl_ACCEL_TYPE_DX11']
/**
   * gapi wip onevpl accel type vaapi constant (2), defined by OpenCV for cv::gapi::wip::onevpl::AccelType.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/streaming/onevpl/accel_types.hpp#L23
   */
  onevpl_AccelType_VAAPI: AugmentedModule['gapi_wip_onevpl_AccelType_VAAPI']
/**
   * gapi wip onevpl accel type vaapi constant (2), defined by OpenCV for cv::gapi::wip::onevpl::AccelType.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/streaming/onevpl/accel_types.hpp#L23
   */
  onevpl_ACCEL_TYPE_VAAPI: AugmentedModule['gapi_wip_onevpl_ACCEL_TYPE_VAAPI']
/**
   * gapi wip onevpl accel type last value constant (std::numeric_limits<uint8_t>::max()), defined by OpenCV for cv::gapi::wip::onevpl::AccelType.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/streaming/onevpl/accel_types.hpp#L25
   */
  onevpl_AccelType_LAST_VALUE: AugmentedModule['gapi_wip_onevpl_AccelType_LAST_VALUE']
/**
   * gapi wip onevpl accel type last value constant (std::numeric_limits<uint8_t>::max()), defined by OpenCV for cv::gapi::wip::onevpl::AccelType.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/streaming/onevpl/accel_types.hpp#L25
   */
  onevpl_ACCEL_TYPE_LAST_VALUE: AugmentedModule['gapi_wip_onevpl_ACCEL_TYPE_LAST_VALUE']
  /** Native gapi.wip.draw namespace. */
  draw: CVNamespace<'gapi_wip_draw'> & {
/**
   * This structure represents a text string to draw.
   *
   * Parameters match cv::putText().
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/render/render_types.hpp#L44
   */
  Text: AugmentedModule['gapi_wip_draw_Text']
/**
   * This structure represents a rectangle to draw.
   *
   * Parameters match cv::rectangle().
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/render/render_types.hpp#L127
   */
  Rect: AugmentedModule['gapi_wip_draw_Rect']
/**
   * This structure represents a circle to draw.
   *
   * Parameters match cv::circle().
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/render/render_types.hpp#L164
   */
  Circle: AugmentedModule['gapi_wip_draw_Circle']
/**
   * This structure represents a line to draw.
   *
   * Parameters match cv::line().
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/render/render_types.hpp#L205
   */
  Line: AugmentedModule['gapi_wip_draw_Line']
/**
   * This structure represents a mosaicing operation.
   *
   * Mosaicing is a very basic method to obfuscate regions in the image.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/render/render_types.hpp#L246
   */
  Mosaic: AugmentedModule['gapi_wip_draw_Mosaic']
/**
   * This structure represents an image to draw.
   *
   * Image is blended on a frame using the specified mask.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/render/render_types.hpp#L277
   */
  Image: AugmentedModule['gapi_wip_draw_Image']
/**
   * This structure represents a polygon to draw.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/render/render_types.hpp#L307
   */
  Poly: AugmentedModule['gapi_wip_draw_Poly']
}
  /** Native gapi.wip.gst namespace. */
  gst: CVNamespace<'gapi_wip_gst'> & {
/**
   * gapi wip gst gstreamer pipeline value in the OpenCV API.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/streaming/gstreamer/gstreamerpipeline.hpp#L22
   */
  GStreamerPipeline: AugmentedModule['gapi_wip_gst_GStreamerPipeline']
/**
   * Indicates what type of data should be produced by GStreamerSource: cv::MediaFrame or cv::Mat
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/streaming/gstreamer/gstreamersource.hpp#L58
   */
  GStreamerSource_OutputType: AugmentedModule['gapi_wip_gst_GStreamerSource_OutputType']
/**
   * gapi wip gst gstreamer source output type frame constant (0), defined by OpenCV for cv::gapi::wip::gst::GStreamerSource::OutputType.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/streaming/gstreamer/gstreamersource.hpp#L59
   */
  GStreamerSource_OutputType_FRAME: AugmentedModule['gapi_wip_gst_GStreamerSource_OutputType_FRAME']
/**
   * gapi wip gst gstreamer source output type frame constant (0), defined by OpenCV for cv::gapi::wip::gst::GStreamerSource::OutputType.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/streaming/gstreamer/gstreamersource.hpp#L59
   */
  GSTREAMER_SOURCE_OUTPUT_TYPE_FRAME: AugmentedModule['gapi_wip_gst_GSTREAMER_SOURCE_OUTPUT_TYPE_FRAME']
/**
   * gapi wip gst gstreamer source output type mat constant (1), defined by OpenCV for cv::gapi::wip::gst::GStreamerSource::OutputType.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/streaming/gstreamer/gstreamersource.hpp#L60
   */
  GStreamerSource_OutputType_MAT: AugmentedModule['gapi_wip_gst_GStreamerSource_OutputType_MAT']
/**
   * gapi wip gst gstreamer source output type mat constant (1), defined by OpenCV for cv::gapi::wip::gst::GStreamerSource::OutputType.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/streaming/gstreamer/gstreamersource.hpp#L60
   */
  GSTREAMER_SOURCE_OUTPUT_TYPE_MAT: AugmentedModule['gapi_wip_gst_GSTREAMER_SOURCE_OUTPUT_TYPE_MAT']
}
  /** Native gapi.wip.onevpl namespace. */
  onevpl: CVNamespace<'gapi_wip_onevpl'> & {
/**
   * Native enum entries for gapi wip onevpl accel type. Pass an entry to enum-typed arguments or its .value to numeric arguments.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/streaming/onevpl/accel_types.hpp#L20
   */
  AccelType: AugmentedModule['gapi_wip_onevpl_AccelType']
/**
   * gapi wip onevpl accel type host constant (0), defined by OpenCV for cv::gapi::wip::onevpl::AccelType.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/streaming/onevpl/accel_types.hpp#L21
   */
  AccelType_HOST: AugmentedModule['gapi_wip_onevpl_AccelType_HOST']
/**
   * gapi wip onevpl accel type host constant (0), defined by OpenCV for cv::gapi::wip::onevpl::AccelType.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/streaming/onevpl/accel_types.hpp#L21
   */
  ACCEL_TYPE_HOST: AugmentedModule['gapi_wip_onevpl_ACCEL_TYPE_HOST']
/**
   * gapi wip onevpl accel type dx11 constant (1), defined by OpenCV for cv::gapi::wip::onevpl::AccelType.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/streaming/onevpl/accel_types.hpp#L22
   */
  AccelType_DX11: AugmentedModule['gapi_wip_onevpl_AccelType_DX11']
/**
   * gapi wip onevpl accel type dx11 constant (1), defined by OpenCV for cv::gapi::wip::onevpl::AccelType.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/streaming/onevpl/accel_types.hpp#L22
   */
  ACCEL_TYPE_DX11: AugmentedModule['gapi_wip_onevpl_ACCEL_TYPE_DX11']
/**
   * gapi wip onevpl accel type vaapi constant (2), defined by OpenCV for cv::gapi::wip::onevpl::AccelType.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/streaming/onevpl/accel_types.hpp#L23
   */
  AccelType_VAAPI: AugmentedModule['gapi_wip_onevpl_AccelType_VAAPI']
/**
   * gapi wip onevpl accel type vaapi constant (2), defined by OpenCV for cv::gapi::wip::onevpl::AccelType.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/streaming/onevpl/accel_types.hpp#L23
   */
  ACCEL_TYPE_VAAPI: AugmentedModule['gapi_wip_onevpl_ACCEL_TYPE_VAAPI']
/**
   * gapi wip onevpl accel type last value constant (std::numeric_limits<uint8_t>::max()), defined by OpenCV for cv::gapi::wip::onevpl::AccelType.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/streaming/onevpl/accel_types.hpp#L25
   */
  AccelType_LAST_VALUE: AugmentedModule['gapi_wip_onevpl_AccelType_LAST_VALUE']
/**
   * gapi wip onevpl accel type last value constant (std::numeric_limits<uint8_t>::max()), defined by OpenCV for cv::gapi::wip::onevpl::AccelType.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/gapi/include/opencv2/gapi/streaming/onevpl/accel_types.hpp#L25
   */
  ACCEL_TYPE_LAST_VALUE: AugmentedModule['gapi_wip_onevpl_ACCEL_TYPE_LAST_VALUE']
}
}
}
  /** Native hdf namespace. */
  hdf: CVNamespace<'hdf'> & {
/**
   * Hierarchical Data Format version 5 interface.
   *
   * Notice that this module is compiled only when hdf5 is correctly installed.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/hdf/include/opencv2/hdf/hdf5.hpp#L56
   */
  HDF5: AugmentedModule['hdf_HDF5']
}
  /** Native hfs namespace. */
  hfs: CVNamespace<'hfs'> & {
/**
   * The opencv hfs module contains an efficient algorithm to segment an image.
   * This module is implemented based on the paper Hierarchical Feature Selection for Efficient
   * Image Segmentation, ECCV 2016. The original project was developed by
   * Yun Liu(https://github.com/yun-liu/hfs).
   *
   * Introduction to Hierarchical Feature Selection
   * ----------------------------------------------
   *
   * This algorithm is executed in 3 stages:
   *
   * In the first stage, the algorithm uses SLIC (simple linear iterative clustering) algorithm
   * to obtain the superpixel of the input image.
   *
   * In the second stage, the algorithm view each superpixel as a node in the graph.
   * It will calculate a feature vector for each edge of the graph. It then calculates a weight
   * for each edge based on the feature vector and trained SVM parameters. After obtaining
   * weight for each edge, it will exploit  EGB (Efficient Graph-based Image Segmentation)
   * algorithm to merge some nodes in the graph thus obtaining a coarser segmentation
   * After these operations, a post process will be executed to merge regions that are smaller
   * then a specific number of pixels into their nearby region.
   *
   * In the third stage, the algorithm exploits the similar mechanism to further merge
   * the small regions obtained in the second stage into even coarser segmentation.
   *
   * After these three stages, we can obtain the final segmentation of the image.
   * For further details about the algorithm, please refer to the original paper:
   * Hierarchical Feature Selection for Efficient Image Segmentation, ECCV 2016
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/hfs/include/opencv2/hfs.hpp#L45
   */
  HfsSegment: AugmentedModule['hfs_HfsSegment']
}
  /** Native img_hash namespace. */
  img_hash: CVNamespace<'img_hash'> & {
/**
   * The base class for image hash algorithms
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/img_hash/include/opencv2/img_hash/img_hash_base.hpp#L18
   */
  ImgHashBase: AugmentedModule['img_hash_ImgHashBase']
/**
   * Computes average hash value of the input image
   *
   * This is a fast image hashing algorithm, but only work on simple case. For more details, please
   * refer to [lookslikeit]
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/img_hash/include/opencv2/img_hash/average_hash.hpp#L21
   */
  AverageHash: AugmentedModule['img_hash_AverageHash']
/**
   * Image hash based on block mean.
   *
   * See [zauner2010implementation] for details.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/img_hash/include/opencv2/img_hash/block_mean_hash.hpp#L26
   */
  BlockMeanHash: AugmentedModule['img_hash_BlockMeanHash']
/**
   * Image hash based on color moments.
   *
   * See [tang2012perceptual] for details.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/img_hash/include/opencv2/img_hash/color_moment_hash.hpp#L20
   */
  ColorMomentHash: AugmentedModule['img_hash_ColorMomentHash']
/**
   * Marr-Hildreth Operator Based Hash, slowest but more discriminative.
   *
   * See [zauner2010implementation] for details.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/img_hash/include/opencv2/img_hash/marr_hildreth_hash.hpp#L20
   */
  MarrHildrethHash: AugmentedModule['img_hash_MarrHildrethHash']
/**
   * pHash
   *
   * Slower than average_hash, but tolerant of minor modifications
   *
   * This algorithm can combat more variation than averageHash, for more details please refer to [lookslikeit]
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/img_hash/include/opencv2/img_hash/phash.hpp#L22
   */
  PHash: AugmentedModule['img_hash_PHash']
/**
   * Image hash based on Radon transform.
   *
   * See [tang2012perceptual] for details.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/img_hash/include/opencv2/img_hash/radial_variance_hash.hpp#L21
   */
  RadialVarianceHash: AugmentedModule['img_hash_RadialVarianceHash']
/**
   * Native enum entries for img hash block mean hash mode. Pass an entry to enum-typed arguments or its .value to numeric arguments.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/img_hash/include/opencv2/img_hash/block_mean_hash.hpp#L16
   */
  BlockMeanHashMode: AugmentedModule['img_hash_BlockMeanHashMode']
/**
   * use fewer block and generate 16*16/8 uchar hash value
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/img_hash/include/opencv2/img_hash/block_mean_hash.hpp#L18
   */
  BLOCK_MEAN_HASH_MODE_0: AugmentedModule['img_hash_BLOCK_MEAN_HASH_MODE_0']
/**
   * use block blocks(step sizes/2), generate 31*31/8 + 1 uchar hash value
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/img_hash/include/opencv2/img_hash/block_mean_hash.hpp#L19
   */
  BLOCK_MEAN_HASH_MODE_1: AugmentedModule['img_hash_BLOCK_MEAN_HASH_MODE_1']
}
  /** Native intensity_transform namespace. */
  intensity_transform: CVNamespace<'intensity_transform'> & {

}
  /** Native ipp namespace. */
  ipp: CVNamespace<'ipp'> & {

}
  /** Native kinfu namespace. */
  kinfu: CVNamespace<'kinfu'> & {
/**
   * kinfu volume params value in the OpenCV API.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/rgbd/include/opencv2/rgbd/kinfu.hpp#L20
   */
  VolumeParams: AugmentedModule['kinfu_VolumeParams']
/**
   * Length of single raycast step
   *         Describes the percentage of voxel length that is skipped per march
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/rgbd/include/opencv2/rgbd/kinfu.hpp#L75
   */
  Params: AugmentedModule['kinfu_Params']
/**
   * KinectFusion implementation
   *
   *   This class implements a 3d reconstruction algorithm described in
   *   [kinectfusion] paper.
   *
   *   It takes a sequence of depth images taken from depth sensor
   *   (or any depth images source such as stereo camera matching algorithm or even raymarching renderer).
   *   The output can be obtained as a vector of points and their normals
   *   or can be Phong-rendered from given camera pose.
   *
   *   An internal representation of a model is a voxel cuboid that keeps TSDF values
   *   which are a sort of distances to the surface (for details read the [kinectfusion] article about TSDF).
   *   There is no interface to that representation yet.
   *
   *   KinFu uses OpenCL acceleration automatically if available.
   *   To enable or disable it explicitly use cv::setUseOptimized() or cv::ocl::setUseOpenCL().
   *
   *   This implementation is based on [kinfu-remake](https://github.com/Nerei/kinfu_remake).
   *
   *   Note that the KinectFusion algorithm was patented and its use may be restricted by
   *   the list of patents mentioned in README.md file in this module directory.
   *
   *   That's why you need to set the OPENCV_ENABLE_NONFREE option in CMake to use KinectFusion.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/rgbd/include/opencv2/rgbd/kinfu.hpp#L250
   */
  KinFu: AugmentedModule['kinfu_KinFu']
}
  /** Native large_kinfu namespace. */
  large_kinfu: CVNamespace<'large_kinfu'> & {
/**
   * large kinfu volume params value in the OpenCV API.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/rgbd/include/opencv2/rgbd/large_kinfu.hpp#L20
   */
  VolumeParams: AugmentedModule['large_kinfu_VolumeParams']
/**
   * large kinfu params value in the OpenCV API.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/rgbd/include/opencv2/rgbd/large_kinfu.hpp#L86
   */
  Params: AugmentedModule['large_kinfu_Params']
/**
   * Large Scale Dense Depth Fusion implementation
   *
   *   This class implements a 3d reconstruction algorithm for larger environments using
   *   Spatially hashed TSDF volume "Submaps".
   *   It also runs a periodic posegraph optimization to minimize drift in tracking over long sequences.
   *   Currently the algorithm does not implement a relocalization or loop closure module.
   *   Potentially a Bag of words implementation or RGBD relocalization as described in
   *   Glocker et al. ISMAR 2013 will be implemented
   *
   *   It takes a sequence of depth images taken from depth sensor
   *   (or any depth images source such as stereo camera matching algorithm or even raymarching
   *   renderer). The output can be obtained as a vector of points and their normals or can be
   *   Phong-rendered from given camera pose.
   *
   *   An internal representation of a model is a spatially hashed voxel cube that stores TSDF values
   *   which represent the distance to the closest surface (for details read the [kinectfusion] article
   *   about TSDF). There is no interface to that representation yet.
   *
   *   For posegraph optimization, a Submap abstraction over the Volume class is created.
   *   New submaps are added to the model when there is low visibility overlap between current viewing frustrum
   *   and the existing volume/model. Multiple submaps are simultaneously tracked and a posegraph is created and
   *   optimized periodically.
   *
   *   LargeKinfu does not use any OpenCL acceleration yet.
   *   To enable or disable it explicitly use cv::setUseOptimized() or cv::ocl::setUseOpenCL().
   *
   *   This implementation is inspired from Kintinuous, InfiniTAM and other SOTA algorithms
   *
   *   You need to set the OPENCV_ENABLE_NONFREE option in CMake to use KinectFusion.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/rgbd/include/opencv2/rgbd/large_kinfu.hpp#L192
   */
  LargeKinfu: AugmentedModule['large_kinfu_LargeKinfu']
}
  /** Native legacy namespace. */
  legacy: CVNamespace<'legacy'> & {
/**
   * Tracker Base Class ***********************************
   * Base abstract class for the long-term tracker:
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/tracking/include/opencv2/tracking/tracking_legacy.hpp#L72
   */
  Tracker: AugmentedModule['legacy_Tracker']
/**
   * Specific Tracker Classes ***********************************
   * The MIL algorithm trains a classifier in an online manner to separate the object from the
   * background.
   *
   * Multiple Instance Learning avoids the drift problem for a robust tracking. The implementation is
   * based on [MIL] .
   *
   * Original code can be found here <http://vision.ucsd.edu/~bbabenko/project_miltrack.shtml>
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/tracking/include/opencv2/tracking/tracking_legacy.hpp#L123
   */
  TrackerMIL: AugmentedModule['legacy_TrackerMIL']
/**
   * the Boosting tracker
   *
   * This is a real-time object tracking based on a novel on-line version of the AdaBoost algorithm.
   * The classifier uses the surrounding background as negative examples in update step to avoid the
   * drifting problem. The implementation is based on [OLB] .
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/tracking/include/opencv2/tracking/tracking_legacy.hpp#L148
   */
  TrackerBoosting: AugmentedModule['legacy_TrackerBoosting']
/**
   * the Median Flow tracker
   *
   * Implementation of a paper [MedianFlow] .
   *
   * The tracker is suitable for very smooth and predictable movements when object is visible throughout
   * the whole sequence. It's quite and accurate for this type of problems (in particular, it was shown
   * by authors to outperform MIL). During the implementation period the code at
   * <http://www.aonsquared.co.uk/node/5>, the courtesy of the author Arthur Amarra, was used for the
   * reference purpose.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/tracking/include/opencv2/tracking/tracking_legacy.hpp#L190
   */
  TrackerMedianFlow: AugmentedModule['legacy_TrackerMedianFlow']
/**
   * the TLD (Tracking, learning and detection) tracker
   *
   * TLD is a novel tracking framework that explicitly decomposes the long-term tracking task into
   * tracking, learning and detection.
   *
   * The tracker follows the object from frame to frame. The detector localizes all appearances that
   * have been observed so far and corrects the tracker if necessary. The learning estimates detector's
   * errors and updates it to avoid these errors in the future. The implementation is based on [TLD] .
   *
   * The Median Flow algorithm (see cv::TrackerMedianFlow) was chosen as a tracking component in this
   * implementation, following authors. The tracker is supposed to be able to handle rapid motions, partial
   * occlusions, object absence etc.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/tracking/include/opencv2/tracking/tracking_legacy.hpp#L232
   */
  TrackerTLD: AugmentedModule['legacy_TrackerTLD']
/**
   * the KCF (Kernelized Correlation Filter) tracker
   * KCF is a novel tracking framework that utilizes properties of circulant matrix to enhance the processing speed.
   * This tracking method is an implementation of [KCF_ECCV] which is extended to KCF with color-names features ([KCF_CN]).
   * The original paper of KCF is available at <http://www.robots.ox.ac.uk/~joao/publications/henriques_tpami2015.pdf>
   * as well as the matlab implementation. For more information about KCF with color-names features, please refer to
   * <http://www.cvl.isy.liu.se/research/objrec/visualtracking/colvistrack/index.html>.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/tracking/include/opencv2/tracking/tracking_legacy.hpp#L260
   */
  TrackerKCF: AugmentedModule['legacy_TrackerKCF']
/**
   * the MOSSE (Minimum Output Sum of Squared %Error) tracker
   *
   * The implementation is based on [MOSSE] Visual Object Tracking using Adaptive Correlation Filters
   *
   * **Note:** this tracker works with grayscale images, if passed bgr ones, they will get converted internally.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/tracking/include/opencv2/tracking/tracking_legacy.hpp#L295
   */
  TrackerMOSSE: AugmentedModule['legacy_TrackerMOSSE']
/**
   * MultiTracker Class ---By Laksono Kurnianggoro---) ***********************************
   * This class is used to track multiple objects using the specified tracker algorithm.
   * The %MultiTracker is naive implementation of multiple object tracking.
   * It process the tracked objects independently without any optimization accross the tracked objects.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/tracking/include/opencv2/tracking/tracking_legacy.hpp#L312
   */
  MultiTracker: AugmentedModule['legacy_MultiTracker']
/**
   * CSRT ***********************************
   * the CSRT tracker
   *
   * The implementation is based on [Lukezic_IJCV2018] Discriminative Correlation Filter with Channel and Spatial Reliability
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/tracking/include/opencv2/tracking/tracking_legacy.hpp#L461
   */
  TrackerCSRT: AugmentedModule['legacy_TrackerCSRT']
}
  /** Native line_descriptor namespace. */
  line_descriptor: CVNamespace<'line_descriptor'> & {
/**
   * An owned native vector. Append values with push_back, read them with get, and release the vector with using or delete(). Native object elements returned by get require separate disposal.
   */
  _KeyLineVector: AugmentedModule['line_descriptor__KeyLineVector']
/**
   * A class to represent a line
   *
   * As aformentioned, it is been necessary to design a class that fully stores the information needed to
   * characterize completely a line and plot it on image it was extracted from, when required.
   * KeyLine* class has been created for such goal; it is mainly inspired to Feature2d's KeyPoint class,
   * since KeyLine shares some of *KeyPoint*'s fields, even if a part of them assumes a different
   * meaning, when speaking about lines. In particular:
   *
   * -   the *class_id* field is used to gather lines extracted from different octaves which refer to
   *     same line inside original image (such lines and the one they represent in original image share
   *     the same *class_id* value)
   * -   the *angle* field represents line's slope with respect to (positive) X axis
   * -   the *pt* field represents line's midpoint
   * -   the *response* field is computed as the ratio between the line's length and maximum between
   *     image's width and height
   * -   the *size* field is the area of the smallest rectangle containing line
   *
   * Apart from fields inspired to KeyPoint class, KeyLines stores information about extremes of line in
   * original image and in octave it was extracted from, about line's length and number of pixels it
   * covers.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/line_descriptor/include/opencv2/line_descriptor/descriptor.hpp#L104
   */
  KeyLine: AugmentedModule['line_descriptor_KeyLine']
/**
   * Class implements both functionalities for detection of lines and computation of their
   * binary descriptor.
   *
   * Class' interface is mainly based on the ones of classical detectors and extractors, such as
   * Feature2d's `features_main` and `features_match.` Retrieved information about lines is
   * stored in line_descriptor::KeyLine objects.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/line_descriptor/include/opencv2/line_descriptor/descriptor.hpp#L182
   */
  BinaryDescriptor: AugmentedModule['line_descriptor_BinaryDescriptor']
/**
   * Lines extraction methodology
   * ----------------------------
   *
   * The lines extraction methodology described in the following is mainly based on [EDL] . The
   * extraction starts with a Gaussian pyramid generated from an original image, downsampled N-1 times,
   * blurred N times, to obtain N layers (one for each octave), with layer 0 corresponding to input
   * image. Then, from each layer (octave) in the pyramid, lines are extracted using LSD algorithm.
   *
   * Differently from EDLine lines extractor used in original article, LSD furnishes information only
   * about lines extremes; thus, additional information regarding slope and equation of line are computed
   * via analytic methods. The number of pixels is obtained using *LineIterator*. Extracted lines are
   * returned in the form of KeyLine objects, but since extraction is based on a method different from
   * the one used in *BinaryDescriptor* class, data associated to a line's extremes in original image and
   * in octave it was extracted from, coincide. KeyLine's field *class_id* is used as an index to
   * indicate the order of extraction of a line inside a single octave.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/line_descriptor/include/opencv2/line_descriptor/descriptor.hpp#L903
   */
  LSDParam: AugmentedModule['line_descriptor_LSDParam']
/**
   * line descriptor lsddetector value in the OpenCV API.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/line_descriptor/include/opencv2/line_descriptor/descriptor.hpp#L924
   */
  LSDDetector: AugmentedModule['line_descriptor_LSDDetector']
/**
   * furnishes all functionalities for querying a dataset provided by user or internal to
   * class (that user must, anyway, populate) on the model of `features_match`
   *
   * Once descriptors have been extracted from an image (both they represent lines and points), it
   * becomes interesting to be able to match a descriptor with another one extracted from a different
   * image and representing the same line or point, seen from a differente perspective or on a different
   * scale. In reaching such goal, the main headache is designing an efficient search algorithm to
   * associate a query descriptor to one extracted from a dataset. In the following, a matching modality
   * based on *Multi-Index Hashing (MiHashing)* will be described.
   *
   * Multi-Index Hashing
   * -------------------
   *
   * The theory described in this section is based on [MIH] . Given a dataset populated with binary
   * codes, each code is indexed *m* times into *m* different hash tables, according to *m* substrings it
   * has been divided into. Thus, given a query code, all the entries close to it at least in one
   * substring are returned by search as *neighbor candidates*. Returned entries are then checked for
   * validity by verifying that their full codes are not distant (in Hamming space) more than *r* bits
   * from query code. In details, each binary code **h** composed of *b* bits is divided into *m*
   * disjoint substrings `\mathbf{h}^{(1)}, ..., \mathbf{h}^{(m)}`, each with length
   * `\lfloor b/m \rfloor` or `\lceil b/m \rceil` bits. Formally, when two codes **h** and **g** differ
   * by at the most *r* bits, in at the least one of their *m* substrings they differ by at the most
   * `\lfloor r/m \rfloor` bits. In particular, when `||\mathbf{h}-\mathbf{g}||_H \le r` (where `||.||_H`
   * is the Hamming norm), there must exist a substring *k* (with `1 \le k \le m`) such that
   *
   * ```math
   * ||\mathbf{h}^{(k)} - \mathbf{g}^{(k)}||_H \le \left\lfloor \frac{r}{m} \right\rfloor .
   * ```
   *
   * That means that if Hamming distance between each of the *m* substring is strictly greater than
   * `\lfloor r/m \rfloor`, then `||\mathbf{h}-\mathbf{g}||_H` must be larger that *r* and that is a
   * contradiction. If the codes in dataset are divided into *m* substrings, then *m* tables will be
   * built. Given a query **q** with substrings `\{\mathbf{q}^{(i)}\}^m_{i=1}`, *i*-th hash table is
   * searched for entries distant at the most `\lfloor r/m \rfloor` from `\mathbf{q}^{(i)}` and a set of
   * candidates `\mathcal{N}_i(\mathbf{q})` is obtained. The union of sets
   * `\mathcal{N}(\mathbf{q}) = \bigcup_i \mathcal{N}_i(\mathbf{q})` is a superset of the *r*-neighbors
   * of **q**. Then, last step of algorithm is computing the Hamming distance between **q** and each
   * element in `\mathcal{N}(\mathbf{q})`, deleting the codes that are distant more that *r* from **q**.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/line_descriptor/include/opencv2/line_descriptor/descriptor.hpp#L1019
   */
  BinaryDescriptorMatcher: AugmentedModule['line_descriptor_BinaryDescriptorMatcher']
/**
   * --------------------------------------------------------------------------------------------
   *  UTILITY FUNCTIONS
   *  --------------------------------------------------------------------------------------------
   * struct for drawing options
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/line_descriptor/include/opencv2/line_descriptor/descriptor.hpp#L1357
   */
  DrawLinesMatchesFlags: AugmentedModule['line_descriptor_DrawLinesMatchesFlags']
}
  /** Native linemod namespace. */
  linemod: CVNamespace<'linemod'> & {
/**
   * An owned native vector. Append values with push_back, read them with get, and release the vector with using or delete(). Native object elements returned by get require separate disposal.
   */
  _TemplateVector: AugmentedModule['linemod__TemplateVector']
/**
   * An owned native vector. Append values with push_back, read them with get, and release the vector with using or delete(). Native object elements returned by get require separate disposal.
   */
  _FeatureVector: AugmentedModule['linemod__FeatureVector']
/**
   * An owned native vector. Append values with push_back, read them with get, and release the vector with using or delete(). Native object elements returned by get require separate disposal.
   */
  _MatchVector: AugmentedModule['linemod__MatchVector']
/**
   * Discriminant feature described by its location and label.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/rgbd/include/opencv2/rgbd/linemod.hpp#L26
   */
  Feature: AugmentedModule['linemod_Feature']
/**
   * linemod template value in the OpenCV API.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/rgbd/include/opencv2/rgbd/linemod.hpp#L41
   */
  Template: AugmentedModule['linemod_Template']
/**
   * Represents a modality operating over an image pyramid.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/rgbd/include/opencv2/rgbd/linemod.hpp#L55
   */
  QuantizedPyramid: AugmentedModule['linemod_QuantizedPyramid']
/**
   * Interface for modalities that plug into the LINE template matching representation.
   *
   * \todo Max response, to allow optimization of summing (255/MAX) features as uint8
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/rgbd/include/opencv2/rgbd/linemod.hpp#L119
   */
  Modality: AugmentedModule['linemod_Modality']
/**
   * Modality that computes quantized gradient orientations from a color image.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/rgbd/include/opencv2/rgbd/linemod.hpp#L166
   */
  ColorGradient: AugmentedModule['linemod_ColorGradient']
/**
   * Modality that computes quantized surface normals from a dense depth map.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/rgbd/include/opencv2/rgbd/linemod.hpp#L203
   */
  DepthNormal: AugmentedModule['linemod_DepthNormal']
/**
   * Represents a successful template match.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/rgbd/include/opencv2/rgbd/linemod.hpp#L259
   */
  Match: AugmentedModule['linemod_Match']
/**
   * Object detector using the LINE template matching algorithm with any set of
   * modalities.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/rgbd/include/opencv2/rgbd/linemod.hpp#L298
   */
  Detector: AugmentedModule['linemod_Detector']
}
  /** Native mcc namespace. */
  mcc: CVNamespace<'mcc'> & {
/**
   * CChecker
   *
   * checker object
   *
   *     This class contains the information about the detected checkers,i.e, their
   *     type, the corners of the chart, the color profile, the cost, centers chart,
   *     etc.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/objdetect/include/opencv2/objdetect/mcc_checker_detector.hpp#L67
   */
  CChecker: AugmentedModule['mcc_CChecker']
/**
   * struct DetectorParametersMCC is used by CCheckerDetector
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/objdetect/include/opencv2/objdetect/mcc_checker_detector.hpp#L104
   */
  DetectorParametersMCC: AugmentedModule['mcc_DetectorParametersMCC']
/**
   * A class to find the positions of the ColorCharts in the image.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/objdetect/include/opencv2/objdetect/mcc_checker_detector.hpp#L190
   */
  CCheckerDetector: AugmentedModule['mcc_CCheckerDetector']
/**
   * ColorChart
   *
   * enum to hold the type of the checker
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/objdetect/include/opencv2/objdetect/mcc_checker_detector.hpp#L52
   */
  ColorChart: AugmentedModule['mcc_ColorChart']
/**
   * Standard Macbeth Chart with 24 squares
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/objdetect/include/opencv2/objdetect/mcc_checker_detector.hpp#L54
   */
  MCC24: AugmentedModule['mcc_MCC24']
/**
   * DigitalSG with 140 squares
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/objdetect/include/opencv2/objdetect/mcc_checker_detector.hpp#L55
   */
  SG140: AugmentedModule['mcc_SG140']
/**
   * DKK color chart with 12 squares and 6 rectangle
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/objdetect/include/opencv2/objdetect/mcc_checker_detector.hpp#L56
   */
  VINYL18: AugmentedModule['mcc_VINYL18']
}
  /** Native ml namespace. */
  ml: CVNamespace<'ml'> & {
/**
   * The structure represents the logarithmic grid range of statmodel parameters.
   *
   * It is used for optimizing statmodel accuracy by varying model parameters, the accuracy estimate
   * being computed by cross-validation.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ml/include/opencv2/ml.hpp#L107
   */
  ParamGrid: AugmentedModule['ml_ParamGrid']
/**
   * Class encapsulating training data.
   *
   * Please note that the class only specifies the interface of training data, but not implementation.
   * All the statistical model classes in _ml_ module accepts Ptr\<TrainData\> as parameter. In other
   * words, you can create your own class derived from TrainData and pass smart pointer to the instance
   * of this class into StatModel::train.
   *
   * See: `ml_intro_data`
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ml/include/opencv2/ml.hpp#L145
   */
  TrainData: AugmentedModule['ml_TrainData']
/**
   * Base class for statistical models in OpenCV ML.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ml/include/opencv2/ml.hpp#L318
   */
  StatModel: AugmentedModule['ml_StatModel']
/**
   * \
   *                                 Normal Bayes Classifier                                *
   * \***************************************************************************************
   * Bayes classifier for normally distributed data.
   *
   * See: `ml_intro_bayes`
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ml/include/opencv2/ml.hpp#L398
   */
  NormalBayesClassifier: AugmentedModule['ml_NormalBayesClassifier']
/**
   * \
   *                          K-Nearest Neighbour Classifier                                *
   * \***************************************************************************************
   * The class implements K-Nearest Neighbors model
   *
   * See: `ml_intro_knn`
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ml/include/opencv2/ml.hpp#L436
   */
  KNearest: AugmentedModule['ml_KNearest']
/**
   * \
   *                                   Support Vector Machines                              *
   * \***************************************************************************************
   * Support Vector Machines.
   *
   * See: `ml_intro_svm`
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ml/include/opencv2/ml.hpp#L526
   */
  SVM: AugmentedModule['ml_SVM']
/**
   * \
   *                              Expectation - Maximization                                *
   * \***************************************************************************************
   * The class implements the Expectation Maximization algorithm.
   *
   * See: `ml_intro_em`
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ml/include/opencv2/ml.hpp#L836
   */
  EM: AugmentedModule['ml_EM']
/**
   * \
   *                                      Decision Tree                                     *
   * \***************************************************************************************
   * The class represents a single decision tree or a collection of decision trees.
   *
   * The current public interface of the class allows user to train only a single decision tree, however
   * the class is capable of storing multiple decision trees and using them for prediction (by summing
   * responses or using a voting schemes), and the derived from DTrees classes (such as RTrees and Boost)
   * use this capability to implement decision tree ensembles.
   *
   * See: `ml_intro_trees`
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ml/include/opencv2/ml.hpp#L1053
   */
  DTrees: AugmentedModule['ml_DTrees']
/**
   * \
   *                                   Random Trees Classifier                              *
   * \***************************************************************************************
   * The class implements the random forest predictor.
   *
   * See: `ml_intro_rtrees`
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ml/include/opencv2/ml.hpp#L1247
   */
  RTrees: AugmentedModule['ml_RTrees']
/**
   * \
   *                                   Boosted tree classifier                              *
   * \***************************************************************************************
   * Boosted tree classifier derived from DTrees
   *
   * See: `ml_intro_boost`
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ml/include/opencv2/ml.hpp#L1332
   */
  Boost: AugmentedModule['ml_Boost']
/**
   * \
   *                                   Gradient Boosted Trees                               *
   * \***************************************************************************************
   * class CV_EXPORTS_W GBTrees : public DTrees
   * {
   * public:
   *     struct CV_EXPORTS_W_MAP Params : public DTrees::Params
   *     {
   *         CV_PROP_RW int weakCount;
   *         CV_PROP_RW int lossFunctionType;
   *         CV_PROP_RW float subsamplePortion;
   *         CV_PROP_RW float shrinkage;
   *
   *         Params();
   *         Params( int lossFunctionType, int weakCount, float shrinkage,
   *                 float subsamplePortion, int maxDepth, bool useSurrogates );
   *     };
   *
   *     enum {SQUARED_LOSS=0, ABSOLUTE_LOSS, HUBER_LOSS=3, DEVIANCE_LOSS};
   *
   *     virtual void setK(int k) = 0;
   *
   *     virtual float predictSerial( InputArray samples,
   *                                  OutputArray weakResponses, int flags) const = 0;
   *
   *     static Ptr<GBTrees> create(const Params& p);
   * };
   * \
   *                              Artificial Neural Networks (ANN)                          *
   * \***************************************************************************************
   * Multi-Layer Perceptrons //////////////////////////////
   * Artificial Neural Networks - Multi-Layer Perceptrons.
   *
   * Unlike many other models in ML that are constructed and trained at once, in the MLP model these
   * steps are separated. First, a network with the specified topology is created using the non-default
   * constructor or the method ANN_MLP::create. All the weights are set to zeros. Then, the network is
   * trained using a set of input and output vectors. The training procedure can be repeated more than
   * once, that is, the weights can be adjusted based on the new training data.
   *
   * Additional flags for StatModel::train are available: ANN_MLP::TrainFlags.
   *
   * See: `ml_intro_ann`
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ml/include/opencv2/ml.hpp#L1431
   */
  ANN_MLP: AugmentedModule['ml_ANN_MLP']
/**
   * \
   *                           Logistic Regression                                          *
   * \***************************************************************************************
   * Implements Logistic Regression classifier.
   *
   * See: `ml_intro_lr`
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ml/include/opencv2/ml.hpp#L1629
   */
  LogisticRegression: AugmentedModule['ml_LogisticRegression']
/**
   * \
   *                        Stochastic Gradient Descent SVM Classifier                      *
   * \***************************************************************************************
   * Stochastic Gradient Descent SVM classifier
   *
   * SVMSGD provides a fast and easy-to-use implementation of the SVM classifier using the Stochastic Gradient Descent approach,
   * as presented in [bottou2010large].
   *
   * The classifier has following parameters:
   * - model type,
   * - margin type,
   * - margin regularization (`\lambda`),
   * - initial step size (`\gamma_0`),
   * - step decreasing power (`c`),
   * - and termination criteria.
   *
   * The model type may have one of the following values: `SGD` and `ASGD.`
   *
   * - `SGD` is the classic version of SVMSGD classifier: every next step is calculated by the formula
   *   
   * ```math
   * w_{t+1} = w_t - \gamma(t) \frac{dQ_i}{dw} |_{w = w_t}
   * ```
   *
   *   where
   *   - `w_t` is the weights vector for decision function at step `t`,
   *   - `\gamma(t)` is the step size of model parameters at the iteration `t`, it is decreased on each step by the formula
   *     `\gamma(t) = \gamma_0  (1 + \lambda  \gamma_0 t) ^ {-c}`
   *   - `Q_i` is the target functional from SVM task for sample with number `i`, this sample is chosen stochastically on each step of the algorithm.
   *
   * - `ASGD` is Average Stochastic Gradient Descent SVM Classifier. ASGD classifier averages weights vector on each step of algorithm by the formula
   * `\widehat{w}_{t+1} = \frac{t}{1+t}\widehat{w}_{t} + \frac{1}{1+t}w_{t+1}`
   *
   * The recommended model type is ASGD (following [bottou2010large]).
   *
   * The margin type may have one of the following values: `SOFT_MARGIN` or `HARD_MARGIN.`
   *
   * - You should use `HARD_MARGIN` type, if you have linearly separable sets.
   * - You should use `SOFT_MARGIN` type, if you have non-linearly separable sets or sets with outliers.
   * - In the general case (if you know nothing about linear separability of your sets), use SOFT_MARGIN.
   *
   * The other parameters may be described as follows:
   * - Margin regularization parameter is responsible for weights decreasing at each step and for the strength of restrictions on outliers
   *   (the less the parameter, the less probability that an outlier will be ignored).
   *   Recommended value for SGD model is 0.0001, for ASGD model is 0.00001.
   *
   * - Initial step size parameter is the initial value for the step size `\gamma(t)`.
   *   You will have to find the best initial step for your problem.
   *
   * - Step decreasing power is the power parameter for `\gamma(t)` decreasing by the formula, mentioned above.
   *   Recommended value for SGD model is 1, for ASGD model is 0.75.
   *
   * - Termination criteria can be TermCriteria::COUNT, TermCriteria::EPS or TermCriteria::COUNT + TermCriteria::EPS.
   *   You will have to find the best termination criteria for your problem.
   *
   * Note that the parameters margin regularization, initial step size, and step decreasing power should be positive.
   *
   * To use SVMSGD algorithm do as follows:
   *
   * - first, create the SVMSGD object. The algorithm will set optimal parameters by default, but you can set your own parameters via functions setSvmsgdType(),
   *   setMarginType(), setMarginRegularization(), setInitialStepSize(), and setStepDecreasingPower().
   *
   * - then the SVM model can be trained using the train features and the correspondent labels by the method train().
   *
   * - after that, the label of a new feature vector can be predicted using the method predict().
   *
   * ```cpp
   * // Create empty object
   * cv::Ptr<SVMSGD> svmsgd = SVMSGD::create();
   *
   * // Train the Stochastic Gradient Descent SVM
   * svmsgd->train(trainData);
   *
   * // Predict labels for the new samples
   * svmsgd->predict(samples, responses);
   *
   * ```
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ml/include/opencv2/ml.hpp#L1796
   */
  SVMSGD: AugmentedModule['ml_SVMSGD']
/**
   * ml_VariableTypes: Variable types
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ml/include/opencv2/ml.hpp#L81
   */
  VariableTypes: AugmentedModule['ml_VariableTypes']
/**
   * ml_ErrorTypes: %Error types
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ml/include/opencv2/ml.hpp#L89
   */
  ErrorTypes: AugmentedModule['ml_ErrorTypes']
/**
   * ml_SampleTypes: Sample types
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ml/include/opencv2/ml.hpp#L96
   */
  SampleTypes: AugmentedModule['ml_SampleTypes']
/**
   * Predict options
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ml/include/opencv2/ml.hpp#L322
   */
  StatModel_Flags: AugmentedModule['ml_StatModel_Flags']
/**
   * Implementations of KNearest algorithm
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ml/include/opencv2/ml.hpp#L497
   */
  KNearest_Types: AugmentedModule['ml_KNearest_Types']
/**
   * ml_SVM_Types: %SVM type
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ml/include/opencv2/ml.hpp#L618
   */
  SVM_Types: AugmentedModule['ml_SVM_Types']
/**
   * %SVM kernel type
   *
   *     A comparison of different kernels on the following 2D test case with four classes. Four
   *     SVM::C_SVC SVMs have been trained (one against rest) with auto_train. Evaluation on three
   *     different kernels (SVM::CHI2, SVM::INTER, SVM::RBF). The color depicts the class with max score.
   *     Bright means max-score \> 0, dark means max-score \< 0.
   *     ![image](pics/SVM_Comparison.png)
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ml/include/opencv2/ml.hpp#L647
   */
  SVM_KernelTypes: AugmentedModule['ml_SVM_KernelTypes']
/**
   * %SVM params type
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ml/include/opencv2/ml.hpp#L669
   */
  SVM_ParamTypes: AugmentedModule['ml_SVM_ParamTypes']
/**
   * Type of covariation matrices
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ml/include/opencv2/ml.hpp#L840
   */
  EM_Types: AugmentedModule['ml_EM_Types']
/**
   * Predict options
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ml/include/opencv2/ml.hpp#L1057
   */
  DTrees_Flags: AugmentedModule['ml_DTrees_Flags']
/**
   * Boosting type.
   *     Gentle AdaBoost and Real AdaBoost are often the preferable choices.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ml/include/opencv2/ml.hpp#L1359
   */
  Boost_Types: AugmentedModule['ml_Boost_Types']
/**
   * Available training methods
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ml/include/opencv2/ml.hpp#L1435
   */
  ANN_MLP_TrainingMethods: AugmentedModule['ml_ANN_MLP_TrainingMethods']
/**
   * possible activation functions
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ml/include/opencv2/ml.hpp#L1563
   */
  ANN_MLP_ActivationFunctions: AugmentedModule['ml_ANN_MLP_ActivationFunctions']
/**
   * ml_ANN_MLP_TrainFlags: Train options
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ml/include/opencv2/ml.hpp#L1581
   */
  ANN_MLP_TrainFlags: AugmentedModule['ml_ANN_MLP_TrainFlags']
/**
   * Regularization kinds
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ml/include/opencv2/ml.hpp#L1672
   */
  LogisticRegression_RegKinds: AugmentedModule['ml_LogisticRegression_RegKinds']
/**
   * Training methods
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ml/include/opencv2/ml.hpp#L1679
   */
  LogisticRegression_Methods: AugmentedModule['ml_LogisticRegression_Methods']
/**
   * SVMSGD type.
   *     ASGD is often the preferable choice.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ml/include/opencv2/ml.hpp#L1802
   */
  SVMSGD_SvmsgdType: AugmentedModule['ml_SVMSGD_SvmsgdType']
/**
   * ml_SVMSGD_MarginType: Margin type.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ml/include/opencv2/ml.hpp#L1809
   */
  SVMSGD_MarginType: AugmentedModule['ml_SVMSGD_MarginType']
/**
   * same as VAR_ORDERED
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ml/include/opencv2/ml.hpp#L83
   */
  VAR_NUMERICAL: AugmentedModule['ml_VAR_NUMERICAL']
/**
   * ordered variables
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ml/include/opencv2/ml.hpp#L84
   */
  VAR_ORDERED: AugmentedModule['ml_VAR_ORDERED']
/**
   * categorical variables
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ml/include/opencv2/ml.hpp#L85
   */
  VAR_CATEGORICAL: AugmentedModule['ml_VAR_CATEGORICAL']
/**
   * ml test error constant (0), defined by OpenCV for cv::ml.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ml/include/opencv2/ml.hpp#L91
   */
  TEST_ERROR: AugmentedModule['ml_TEST_ERROR']
/**
   * ml train error constant (1), defined by OpenCV for cv::ml.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ml/include/opencv2/ml.hpp#L92
   */
  TRAIN_ERROR: AugmentedModule['ml_TRAIN_ERROR']
/**
   * each training sample is a row of samples
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ml/include/opencv2/ml.hpp#L98
   */
  ROW_SAMPLE: AugmentedModule['ml_ROW_SAMPLE']
/**
   * each training sample occupies a column of samples
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ml/include/opencv2/ml.hpp#L99
   */
  COL_SAMPLE: AugmentedModule['ml_COL_SAMPLE']
/**
   * ml stat model update model constant (1), defined by OpenCV for cv::ml::StatModel.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ml/include/opencv2/ml.hpp#L323
   */
  StatModel_UPDATE_MODEL: AugmentedModule['ml_StatModel_UPDATE_MODEL']
/**
   * ml stat model update model constant (1), defined by OpenCV for cv::ml::StatModel.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ml/include/opencv2/ml.hpp#L323
   */
  STAT_MODEL_UPDATE_MODEL: AugmentedModule['ml_STAT_MODEL_UPDATE_MODEL']
/**
   * makes the method return the raw results (the sum), not the class label
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ml/include/opencv2/ml.hpp#L324
   */
  StatModel_RAW_OUTPUT: AugmentedModule['ml_StatModel_RAW_OUTPUT']
/**
   * makes the method return the raw results (the sum), not the class label
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ml/include/opencv2/ml.hpp#L324
   */
  STAT_MODEL_RAW_OUTPUT: AugmentedModule['ml_STAT_MODEL_RAW_OUTPUT']
/**
   * makes the method return the raw results (the sum), not the class label
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ml/include/opencv2/ml.hpp#L325
   */
  StatModel_COMPRESSED_INPUT: AugmentedModule['ml_StatModel_COMPRESSED_INPUT']
/**
   * makes the method return the raw results (the sum), not the class label
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ml/include/opencv2/ml.hpp#L325
   */
  STAT_MODEL_COMPRESSED_INPUT: AugmentedModule['ml_STAT_MODEL_COMPRESSED_INPUT']
/**
   * ml stat model preprocessed input constant (4), defined by OpenCV for cv::ml::StatModel.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ml/include/opencv2/ml.hpp#L326
   */
  StatModel_PREPROCESSED_INPUT: AugmentedModule['ml_StatModel_PREPROCESSED_INPUT']
/**
   * ml stat model preprocessed input constant (4), defined by OpenCV for cv::ml::StatModel.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ml/include/opencv2/ml.hpp#L326
   */
  STAT_MODEL_PREPROCESSED_INPUT: AugmentedModule['ml_STAT_MODEL_PREPROCESSED_INPUT']
/**
   * ml knearest brute force constant (1), defined by OpenCV for cv::ml::KNearest.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ml/include/opencv2/ml.hpp#L499
   */
  KNearest_BRUTE_FORCE: AugmentedModule['ml_KNearest_BRUTE_FORCE']
/**
   * ml knearest brute force constant (1), defined by OpenCV for cv::ml::KNearest.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ml/include/opencv2/ml.hpp#L499
   */
  KNEAREST_BRUTE_FORCE: AugmentedModule['ml_KNEAREST_BRUTE_FORCE']
/**
   * ml knearest kdtree constant (2), defined by OpenCV for cv::ml::KNearest.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ml/include/opencv2/ml.hpp#L500
   */
  KNearest_KDTREE: AugmentedModule['ml_KNearest_KDTREE']
/**
   * ml knearest kdtree constant (2), defined by OpenCV for cv::ml::KNearest.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ml/include/opencv2/ml.hpp#L500
   */
  KNEAREST_KDTREE: AugmentedModule['ml_KNEAREST_KDTREE']
/**
   * C-Support Vector Classification. n-class classification (n `\geq` 2), allows
   *         imperfect separation of classes with penalty multiplier C for outliers.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ml/include/opencv2/ml.hpp#L621
   */
  SVM_C_SVC: AugmentedModule['ml_SVM_C_SVC']
/**
   * `\nu`-Support Vector Classification. n-class classification with possible
   *         imperfect separation. Parameter `\nu` (in the range 0..1, the larger the value, the smoother
   *         the decision boundary) is used instead of C.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ml/include/opencv2/ml.hpp#L625
   */
  SVM_NU_SVC: AugmentedModule['ml_SVM_NU_SVC']
/**
   * Distribution Estimation (One-class %SVM). All the training data are from
   *         the same class, %SVM builds a boundary that separates the class from the rest of the feature
   *         space.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ml/include/opencv2/ml.hpp#L629
   */
  SVM_ONE_CLASS: AugmentedModule['ml_SVM_ONE_CLASS']
/**
   * `\epsilon`-Support Vector Regression. The distance between feature vectors
   *         from the training set and the fitting hyper-plane must be less than p. For outliers the
   *         penalty multiplier C is used.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ml/include/opencv2/ml.hpp#L633
   */
  SVM_EPS_SVR: AugmentedModule['ml_SVM_EPS_SVR']
/**
   * `\nu`-Support Vector Regression. `\nu` is used instead of p.
   *         See [LibSVM] for details.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ml/include/opencv2/ml.hpp#L636
   */
  SVM_NU_SVR: AugmentedModule['ml_SVM_NU_SVR']
/**
   * Returned by SVM::getKernelType in case when custom kernel has been set
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ml/include/opencv2/ml.hpp#L649
   */
  SVM_CUSTOM: AugmentedModule['ml_SVM_CUSTOM']
/**
   * Linear kernel. No mapping is done, linear discrimination (or regression) is
   *         done in the original feature space. It is the fastest option. `K(x_i, x_j) = x_i^T x_j`.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ml/include/opencv2/ml.hpp#L652
   */
  SVM_LINEAR: AugmentedModule['ml_SVM_LINEAR']
/**
   * Polynomial kernel:
   *         `K(x_i, x_j) = (\gamma x_i^T x_j + coef0)^{degree}, \gamma > 0`.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ml/include/opencv2/ml.hpp#L655
   */
  SVM_POLY: AugmentedModule['ml_SVM_POLY']
/**
   * Exponential Chi2 kernel, similar to the RBF kernel:
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ml/include/opencv2/ml.hpp#L661
   */
  SVM_RBF: AugmentedModule['ml_SVM_RBF']
/**
   * Sigmoid kernel: `K(x_i, x_j) = \tanh(\gamma x_i^T x_j + coef0)`.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ml/include/opencv2/ml.hpp#L660
   */
  SVM_SIGMOID: AugmentedModule['ml_SVM_SIGMOID']
/**
   * Exponential Chi2 kernel, similar to the RBF kernel:
   *         `K(x_i, x_j) = e^{-\gamma \chi^2(x_i,x_j)}, \chi^2(x_i,x_j) = (x_i-x_j)^2/(x_i+x_j), \gamma > 0`.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ml/include/opencv2/ml.hpp#L663
   */
  SVM_CHI2: AugmentedModule['ml_SVM_CHI2']
/**
   * Histogram intersection kernel. A fast kernel. `K(x_i, x_j) = min(x_i,x_j)`.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ml/include/opencv2/ml.hpp#L665
   */
  SVM_INTER: AugmentedModule['ml_SVM_INTER']
/**
   * ml svm c constant (0), defined by OpenCV for cv::ml::SVM.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ml/include/opencv2/ml.hpp#L670
   */
  SVM_C: AugmentedModule['ml_SVM_C']
/**
   * ml svm gamma constant (1), defined by OpenCV for cv::ml::SVM.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ml/include/opencv2/ml.hpp#L671
   */
  SVM_GAMMA: AugmentedModule['ml_SVM_GAMMA']
/**
   * ml svm p constant (2), defined by OpenCV for cv::ml::SVM.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ml/include/opencv2/ml.hpp#L672
   */
  SVM_P: AugmentedModule['ml_SVM_P']
/**
   * ml svm nu constant (3), defined by OpenCV for cv::ml::SVM.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ml/include/opencv2/ml.hpp#L673
   */
  SVM_NU: AugmentedModule['ml_SVM_NU']
/**
   * ml svm coef constant (4), defined by OpenCV for cv::ml::SVM.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ml/include/opencv2/ml.hpp#L674
   */
  SVM_COEF: AugmentedModule['ml_SVM_COEF']
/**
   * ml svm degree constant (5), defined by OpenCV for cv::ml::SVM.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ml/include/opencv2/ml.hpp#L675
   */
  SVM_DEGREE: AugmentedModule['ml_SVM_DEGREE']
/**
   * A scaled identity matrix `\mu_k * I`. There is the only
   *         parameter `\mu_k` to be estimated for each matrix. The option may be used in special cases,
   *         when the constraint is relevant, or as a first step in the optimization (for example in case
   *         when the data is preprocessed with PCA). The results of such preliminary estimation may be
   *         passed again to the optimization procedure, this time with
   *         covMatType=EM::COV_MAT_DIAGONAL.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ml/include/opencv2/ml.hpp#L847
   */
  EM_COV_MAT_SPHERICAL: AugmentedModule['ml_EM_COV_MAT_SPHERICAL']
/**
   * A symmetric positively defined matrix. The number of free
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ml/include/opencv2/ml.hpp#L857
   */
  EM_COV_MAT_DIAGONAL: AugmentedModule['ml_EM_COV_MAT_DIAGONAL']
/**
   * A symmetric positively defined matrix. The number of free
   *         parameters in each matrix is about `d^2/2`. It is not recommended to use this option, unless
   *         there is pretty accurate initial estimation of the parameters and/or a huge number of
   *         training samples.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ml/include/opencv2/ml.hpp#L856
   */
  EM_COV_MAT_GENERIC: AugmentedModule['ml_EM_COV_MAT_GENERIC']
/**
   * ml em cov mat default constant (COV_MAT_DIAGONAL), defined by OpenCV for cv::ml::EM.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ml/include/opencv2/ml.hpp#L857
   */
  EM_COV_MAT_DEFAULT: AugmentedModule['ml_EM_COV_MAT_DEFAULT']
/**
   * Default parameters
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ml/include/opencv2/ml.hpp#L861
   */
  EM_DEFAULT_NCLUSTERS: AugmentedModule['ml_EM_DEFAULT_NCLUSTERS']
/**
   * Default parameters
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ml/include/opencv2/ml.hpp#L861
   */
  EM_DEFAULT_MAX_ITERS: AugmentedModule['ml_EM_DEFAULT_MAX_ITERS']
/**
   * The initial step
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ml/include/opencv2/ml.hpp#L864
   */
  EM_START_E_STEP: AugmentedModule['ml_EM_START_E_STEP']
/**
   * The initial step
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ml/include/opencv2/ml.hpp#L864
   */
  EM_START_M_STEP: AugmentedModule['ml_EM_START_M_STEP']
/**
   * The initial step
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ml/include/opencv2/ml.hpp#L864
   */
  EM_START_AUTO_STEP: AugmentedModule['ml_EM_START_AUTO_STEP']
/**
   * Predict options
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ml/include/opencv2/ml.hpp#L1057
   */
  DTrees_PREDICT_AUTO: AugmentedModule['ml_DTrees_PREDICT_AUTO']
/**
   * Predict options
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ml/include/opencv2/ml.hpp#L1057
   */
  DTREES_PREDICT_AUTO: AugmentedModule['ml_DTREES_PREDICT_AUTO']
/**
   * Predict options
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ml/include/opencv2/ml.hpp#L1057
   */
  DTrees_PREDICT_SUM: AugmentedModule['ml_DTrees_PREDICT_SUM']
/**
   * Predict options
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ml/include/opencv2/ml.hpp#L1057
   */
  DTREES_PREDICT_SUM: AugmentedModule['ml_DTREES_PREDICT_SUM']
/**
   * Predict options
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ml/include/opencv2/ml.hpp#L1057
   */
  DTrees_PREDICT_MAX_VOTE: AugmentedModule['ml_DTrees_PREDICT_MAX_VOTE']
/**
   * Predict options
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ml/include/opencv2/ml.hpp#L1057
   */
  DTREES_PREDICT_MAX_VOTE: AugmentedModule['ml_DTREES_PREDICT_MAX_VOTE']
/**
   * Predict options
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ml/include/opencv2/ml.hpp#L1057
   */
  DTrees_PREDICT_MASK: AugmentedModule['ml_DTrees_PREDICT_MASK']
/**
   * Predict options
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ml/include/opencv2/ml.hpp#L1057
   */
  DTREES_PREDICT_MASK: AugmentedModule['ml_DTREES_PREDICT_MASK']
/**
   * Discrete AdaBoost.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ml/include/opencv2/ml.hpp#L1360
   */
  Boost_DISCRETE: AugmentedModule['ml_Boost_DISCRETE']
/**
   * Discrete AdaBoost.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ml/include/opencv2/ml.hpp#L1360
   */
  BOOST_DISCRETE: AugmentedModule['ml_BOOST_DISCRETE']
/**
   * Real AdaBoost. It is a technique that utilizes confidence-rated predictions
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ml/include/opencv2/ml.hpp#L1361
   */
  Boost_REAL: AugmentedModule['ml_Boost_REAL']
/**
   * Real AdaBoost. It is a technique that utilizes confidence-rated predictions
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ml/include/opencv2/ml.hpp#L1361
   */
  BOOST_REAL: AugmentedModule['ml_BOOST_REAL']
/**
   * LogitBoost. It can produce good regression fits.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ml/include/opencv2/ml.hpp#L1363
   */
  Boost_LOGIT: AugmentedModule['ml_Boost_LOGIT']
/**
   * LogitBoost. It can produce good regression fits.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ml/include/opencv2/ml.hpp#L1363
   */
  BOOST_LOGIT: AugmentedModule['ml_BOOST_LOGIT']
/**
   * Gentle AdaBoost. It puts less weight on outlier data points and for that
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ml/include/opencv2/ml.hpp#L1364
   */
  Boost_GENTLE: AugmentedModule['ml_Boost_GENTLE']
/**
   * Gentle AdaBoost. It puts less weight on outlier data points and for that
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ml/include/opencv2/ml.hpp#L1364
   */
  BOOST_GENTLE: AugmentedModule['ml_BOOST_GENTLE']
/**
   * The back-propagation algorithm.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ml/include/opencv2/ml.hpp#L1436
   */
  ANN_MLP_BACKPROP: AugmentedModule['ml_ANN_MLP_BACKPROP']
/**
   * The RPROP algorithm. See [RPROP93] for details.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ml/include/opencv2/ml.hpp#L1437
   */
  ANN_MLP_RPROP: AugmentedModule['ml_ANN_MLP_RPROP']
/**
   * The simulated annealing algorithm. See [Kirkpatrick83] for details.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ml/include/opencv2/ml.hpp#L1438
   */
  ANN_MLP_ANNEAL: AugmentedModule['ml_ANN_MLP_ANNEAL']
/**
   * Identity function: `f(x)=x`
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ml/include/opencv2/ml.hpp#L1565
   */
  ANN_MLP_IDENTITY: AugmentedModule['ml_ANN_MLP_IDENTITY']
/**
   * Symmetrical sigmoid: `f(x)=\beta*(1-e^{-\alpha x})/(1+e^{-\alpha x})`
   *         
   * **Note:** If you are using the default sigmoid activation function with the default parameter values
   *         fparam1=0 and fparam2=0 then the function used is y = 1.7159\*tanh(2/3 \* x), so the output
   *         will range from [-1.7159, 1.7159], instead of [0,1].
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ml/include/opencv2/ml.hpp#L1571
   */
  ANN_MLP_SIGMOID_SYM: AugmentedModule['ml_ANN_MLP_SIGMOID_SYM']
/**
   * Gaussian function: `f(x)=\beta e^{-\alpha x*x}`
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ml/include/opencv2/ml.hpp#L1573
   */
  ANN_MLP_GAUSSIAN: AugmentedModule['ml_ANN_MLP_GAUSSIAN']
/**
   * ReLU function: `f(x)=max(0,x)`
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ml/include/opencv2/ml.hpp#L1575
   */
  ANN_MLP_RELU: AugmentedModule['ml_ANN_MLP_RELU']
/**
   * Leaky ReLU function: for x>0 `f(x)=x ` and x<=0 `f(x)=\alpha x `
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ml/include/opencv2/ml.hpp#L1577
   */
  ANN_MLP_LEAKYRELU: AugmentedModule['ml_ANN_MLP_LEAKYRELU']
/**
   * Update the network weights, rather than compute them from scratch. In the latter case
   *         the weights are initialized using the Nguyen-Widrow algorithm.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ml/include/opencv2/ml.hpp#L1584
   */
  ANN_MLP_UPDATE_WEIGHTS: AugmentedModule['ml_ANN_MLP_UPDATE_WEIGHTS']
/**
   * Do not normalize the input vectors. If this flag is not set, the training algorithm
   *         normalizes each input feature independently, shifting its mean value to 0 and making the
   *         standard deviation equal to 1. If the network is assumed to be updated frequently, the new
   *         training data could be much different from original one. In this case, you should take care
   *         of proper normalization.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ml/include/opencv2/ml.hpp#L1590
   */
  ANN_MLP_NO_INPUT_SCALE: AugmentedModule['ml_ANN_MLP_NO_INPUT_SCALE']
/**
   * Do not normalize the output vectors. If the flag is not set, the training algorithm
   *         normalizes each output feature independently, by transforming it to the certain range
   *         depending on the used activation function.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ml/include/opencv2/ml.hpp#L1594
   */
  ANN_MLP_NO_OUTPUT_SCALE: AugmentedModule['ml_ANN_MLP_NO_OUTPUT_SCALE']
/**
   * Regularization disabled
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ml/include/opencv2/ml.hpp#L1673
   */
  LogisticRegression_REG_DISABLE: AugmentedModule['ml_LogisticRegression_REG_DISABLE']
/**
   * Regularization disabled
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ml/include/opencv2/ml.hpp#L1673
   */
  LOGISTIC_REGRESSION_REG_DISABLE: AugmentedModule['ml_LOGISTIC_REGRESSION_REG_DISABLE']
/**
   * ml_LogisticRegression_REG_L1: %L1 norm
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ml/include/opencv2/ml.hpp#L1674
   */
  LogisticRegression_REG_L1: AugmentedModule['ml_LogisticRegression_REG_L1']
/**
   * ml_LOGISTIC_REGRESSION_REG_L1: %L1 norm
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ml/include/opencv2/ml.hpp#L1674
   */
  LOGISTIC_REGRESSION_REG_L1: AugmentedModule['ml_LOGISTIC_REGRESSION_REG_L1']
/**
   * ml_LogisticRegression_REG_L2: %L2 norm
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ml/include/opencv2/ml.hpp#L1675
   */
  LogisticRegression_REG_L2: AugmentedModule['ml_LogisticRegression_REG_L2']
/**
   * ml_LOGISTIC_REGRESSION_REG_L2: %L2 norm
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ml/include/opencv2/ml.hpp#L1675
   */
  LOGISTIC_REGRESSION_REG_L2: AugmentedModule['ml_LOGISTIC_REGRESSION_REG_L2']
/**
   * ml logistic regression batch constant (0), defined by OpenCV for cv::ml::LogisticRegression.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ml/include/opencv2/ml.hpp#L1680
   */
  LogisticRegression_BATCH: AugmentedModule['ml_LogisticRegression_BATCH']
/**
   * ml logistic regression batch constant (0), defined by OpenCV for cv::ml::LogisticRegression.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ml/include/opencv2/ml.hpp#L1680
   */
  LOGISTIC_REGRESSION_BATCH: AugmentedModule['ml_LOGISTIC_REGRESSION_BATCH']
/**
   * Set MiniBatchSize to a positive integer when using this method.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ml/include/opencv2/ml.hpp#L1681
   */
  LogisticRegression_MINI_BATCH: AugmentedModule['ml_LogisticRegression_MINI_BATCH']
/**
   * Set MiniBatchSize to a positive integer when using this method.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ml/include/opencv2/ml.hpp#L1681
   */
  LOGISTIC_REGRESSION_MINI_BATCH: AugmentedModule['ml_LOGISTIC_REGRESSION_MINI_BATCH']
/**
   * Stochastic Gradient Descent
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ml/include/opencv2/ml.hpp#L1804
   */
  SVMSGD_SGD: AugmentedModule['ml_SVMSGD_SGD']
/**
   * Average Stochastic Gradient Descent
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ml/include/opencv2/ml.hpp#L1805
   */
  SVMSGD_ASGD: AugmentedModule['ml_SVMSGD_ASGD']
/**
   * General case, suits to the case of non-linearly separable sets, allows outliers.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ml/include/opencv2/ml.hpp#L1811
   */
  SVMSGD_SOFT_MARGIN: AugmentedModule['ml_SVMSGD_SOFT_MARGIN']
/**
   * More accurate for the case of linearly separable sets.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ml/include/opencv2/ml.hpp#L1812
   */
  SVMSGD_HARD_MARGIN: AugmentedModule['ml_SVMSGD_HARD_MARGIN']
}
  /** Native motempl namespace. */
  motempl: CVNamespace<'motempl'> & {

}
  /** Native multicalib namespace. */
  multicalib: CVNamespace<'multicalib'> & {
/**
   * multicalib multi camera calibration pinhole constant (0), defined by OpenCV for cv::multicalib::MultiCameraCalibration.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ccalib/include/opencv2/ccalib/multicalib.hpp#L76
   */
  MultiCameraCalibration_PINHOLE: AugmentedModule['multicalib_MultiCameraCalibration_PINHOLE']
/**
   * multicalib multi camera calibration pinhole constant (0), defined by OpenCV for cv::multicalib::MultiCameraCalibration.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ccalib/include/opencv2/ccalib/multicalib.hpp#L76
   */
  MULTI_CAMERA_CALIBRATION_PINHOLE: AugmentedModule['multicalib_MULTI_CAMERA_CALIBRATION_PINHOLE']
/**
   * multicalib multi camera calibration omnidirectional constant (1), defined by OpenCV for cv::multicalib::MultiCameraCalibration.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ccalib/include/opencv2/ccalib/multicalib.hpp#L77
   */
  MultiCameraCalibration_OMNIDIRECTIONAL: AugmentedModule['multicalib_MultiCameraCalibration_OMNIDIRECTIONAL']
/**
   * multicalib multi camera calibration omnidirectional constant (1), defined by OpenCV for cv::multicalib::MultiCameraCalibration.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ccalib/include/opencv2/ccalib/multicalib.hpp#L77
   */
  MULTI_CAMERA_CALIBRATION_OMNIDIRECTIONAL: AugmentedModule['multicalib_MULTI_CAMERA_CALIBRATION_OMNIDIRECTIONAL']
}
  /** Native omnidir namespace. */
  omnidir: CVNamespace<'omnidir'> & {
/**
   * omnidir calib use guess constant (1), defined by OpenCV for cv::omnidir.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ccalib/include/opencv2/ccalib/omnidir.hpp#L57
   */
  CALIB_USE_GUESS: AugmentedModule['omnidir_CALIB_USE_GUESS']
/**
   * omnidir calib fix skew constant (2), defined by OpenCV for cv::omnidir.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ccalib/include/opencv2/ccalib/omnidir.hpp#L58
   */
  CALIB_FIX_SKEW: AugmentedModule['omnidir_CALIB_FIX_SKEW']
/**
   * omnidir calib fix k1 constant (4), defined by OpenCV for cv::omnidir.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ccalib/include/opencv2/ccalib/omnidir.hpp#L59
   */
  CALIB_FIX_K1: AugmentedModule['omnidir_CALIB_FIX_K1']
/**
   * omnidir calib fix k2 constant (8), defined by OpenCV for cv::omnidir.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ccalib/include/opencv2/ccalib/omnidir.hpp#L60
   */
  CALIB_FIX_K2: AugmentedModule['omnidir_CALIB_FIX_K2']
/**
   * omnidir calib fix p1 constant (16), defined by OpenCV for cv::omnidir.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ccalib/include/opencv2/ccalib/omnidir.hpp#L61
   */
  CALIB_FIX_P1: AugmentedModule['omnidir_CALIB_FIX_P1']
/**
   * omnidir calib fix p2 constant (32), defined by OpenCV for cv::omnidir.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ccalib/include/opencv2/ccalib/omnidir.hpp#L62
   */
  CALIB_FIX_P2: AugmentedModule['omnidir_CALIB_FIX_P2']
/**
   * omnidir calib fix xi constant (64), defined by OpenCV for cv::omnidir.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ccalib/include/opencv2/ccalib/omnidir.hpp#L63
   */
  CALIB_FIX_XI: AugmentedModule['omnidir_CALIB_FIX_XI']
/**
   * omnidir calib fix gamma constant (128), defined by OpenCV for cv::omnidir.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ccalib/include/opencv2/ccalib/omnidir.hpp#L64
   */
  CALIB_FIX_GAMMA: AugmentedModule['omnidir_CALIB_FIX_GAMMA']
/**
   * omnidir calib fix center constant (256), defined by OpenCV for cv::omnidir.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ccalib/include/opencv2/ccalib/omnidir.hpp#L65
   */
  CALIB_FIX_CENTER: AugmentedModule['omnidir_CALIB_FIX_CENTER']
/**
   * omnidir rectify perspective constant (1), defined by OpenCV for cv::omnidir.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ccalib/include/opencv2/ccalib/omnidir.hpp#L69
   */
  RECTIFY_PERSPECTIVE: AugmentedModule['omnidir_RECTIFY_PERSPECTIVE']
/**
   * omnidir rectify cylindrical constant (2), defined by OpenCV for cv::omnidir.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ccalib/include/opencv2/ccalib/omnidir.hpp#L70
   */
  RECTIFY_CYLINDRICAL: AugmentedModule['omnidir_RECTIFY_CYLINDRICAL']
/**
   * omnidir rectify longlati constant (3), defined by OpenCV for cv::omnidir.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ccalib/include/opencv2/ccalib/omnidir.hpp#L71
   */
  RECTIFY_LONGLATI: AugmentedModule['omnidir_RECTIFY_LONGLATI']
/**
   * omnidir rectify stereographic constant (4), defined by OpenCV for cv::omnidir.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ccalib/include/opencv2/ccalib/omnidir.hpp#L72
   */
  RECTIFY_STEREOGRAPHIC: AugmentedModule['omnidir_RECTIFY_STEREOGRAPHIC']
/**
   * omnidir xyzrgb constant (1), defined by OpenCV for cv::omnidir.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ccalib/include/opencv2/ccalib/omnidir.hpp#L76
   */
  XYZRGB: AugmentedModule['omnidir_XYZRGB']
/**
   * omnidir xyz constant (2), defined by OpenCV for cv::omnidir.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ccalib/include/opencv2/ccalib/omnidir.hpp#L77
   */
  XYZ: AugmentedModule['omnidir_XYZ']
}
  /** Native optflow namespace. */
  optflow: CVNamespace<'optflow'> & {
/**
   * "Dual TV L1" Optical Flow Algorithm.
   *
   * The class implements the "Dual TV L1" optical flow algorithm described in [Zach2007] and
   * [Javier2012] .
   * Here are important members of the class that control the algorithm, which you can set after
   * constructing the class instance:
   *
   * -   member double tau
   *     Time step of the numerical scheme.
   *
   * -   member double lambda
   *     Weight parameter for the data term, attachment parameter. This is the most relevant
   *     parameter, which determines the smoothness of the output. The smaller this parameter is,
   *     the smoother the solutions we obtain. It depends on the range of motions of the images, so
   *     its value should be adapted to each image sequence.
   *
   * -   member double theta
   *     Weight parameter for (u - v)\^2, tightness parameter. It serves as a link between the
   *     attachment and the regularization terms. In theory, it should have a small value in order
   *     to maintain both parts in correspondence. The method is stable for a large range of values
   *     of this parameter.
   *
   * -   member int nscales
   *     Number of scales used to create the pyramid of images.
   *
   * -   member int warps
   *     Number of warpings per scale. Represents the number of times that I1(x+u0) and grad(
   *     I1(x+u0) ) are computed per scale. This is a parameter that assures the stability of the
   *     method. It also affects the running time, so it is a compromise between speed and
   *     accuracy.
   *
   * -   member double epsilon
   *     Stopping criterion threshold used in the numerical scheme, which is a trade-off between
   *     precision and running time. A small value will yield more accurate solutions at the
   *     expense of a slower convergence.
   *
   * -   member int iterations
   *     Stopping criterion iterations number used in the numerical scheme.
   *
   * C. Zach, T. Pock and H. Bischof, "A Duality Based Approach for Realtime TV-L1 Optical Flow".
   * Javier Sanchez, Enric Meinhardt-Llopis and Gabriele Facciolo. "TV-L1 Optical Flow Estimation".
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/optflow/include/opencv2/optflow.hpp#L218
   */
  DualTVL1OpticalFlow: AugmentedModule['optflow_DualTVL1OpticalFlow']
/**
   * This class can be used for imposing a learned prior on the resulting optical flow.
   * Solution will be regularized according to this prior.
   * You need to generate appropriate prior file with "learn_prior.py" script beforehand.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/optflow/include/opencv2/optflow/pcaflow.hpp#L74
   */
  PCAPrior: AugmentedModule['optflow_PCAPrior']
/**
   * PCAFlow algorithm.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/optflow/include/opencv2/optflow/pcaflow.hpp#L94
   */
  OpticalFlowPCAFlow: AugmentedModule['optflow_OpticalFlowPCAFlow']
/**
   * This is used store and set up the parameters of the robust local optical flow (RLOF) algoritm.
   *
   * The RLOF is a fast local optical flow approach described in [Senst2012] [Senst2013] [Senst2014]
   * and [Senst2016] similar to the pyramidal iterative Lucas-Kanade method as
   * proposed by [Bouguet00]. More details and experiments can be found in the following thesis [Senst2019].
   * The implementation is derived from optflow::calcOpticalFlowPyrLK().
   * This RLOF implementation can be seen as an improved pyramidal iterative Lucas-Kanade and includes
   * a set of improving modules. The main improvements in respect to the pyramidal iterative Lucas-Kanade
   * are:
   *  - A more robust redecending M-estimator framework (see [Senst2012]) to improve the accuracy at
   *     motion boundaries and appearing and disappearing pixels.
   *  - an adaptive support region strategies to improve the accuracy at motion boundaries to reduce the
   *     corona effect, i.e oversmoothing of the PLK at motion/object boundaries. The cross-based segementation
   *     strategy (SR_CROSS) proposed in [Senst2014] uses a simple segmenation approach to obtain the optimal
   *     shape of the support region.
   *  - To deal with illumination changes (outdoor sequences and shadow) the intensity constancy assumption
   *     based optical flow equation has been adopt with the Gennert and Negahdaripour illumination model
   *     (see [Senst2016]). This model can be switched on/off with the useIlluminationModel variable.
   *  - By using a global motion prior initialization (see [Senst2016]) of the iterative refinement
   *     the accuracy could be significantly improved for large displacements. This initialization can be
   *     switched on and of with useGlobalMotionPrior variable.
   *
   * The RLOF can be computed with the SparseOpticalFlow class or function interface to track a set of features
   * or with the DenseOpticalFlow class or function interface to compute dense optical flow.
   *
   * See: optflow::DenseRLOFOpticalFlow, optflow::calcOpticalFlowDenseRLOF(), optflow::SparseRLOFOpticalFlow, optflow::calcOpticalFlowSparseRLOF()
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/optflow/include/opencv2/optflow/rlofflow.hpp#L64
   */
  RLOFOpticalFlowParameter: AugmentedModule['optflow_RLOFOpticalFlowParameter']
/**
   * Fast dense optical flow computation based on robust local optical flow (RLOF) algorithms and sparse-to-dense interpolation
   * scheme.
   *
   * The RLOF is a fast local optical flow approach described in [Senst2012] [Senst2013] [Senst2014]
   * and [Senst2016] similar to the pyramidal iterative Lucas-Kanade method as
   * proposed by [Bouguet00]. More details and experiments can be found in the following thesis [Senst2019].
   * The implementation is derived from optflow::calcOpticalFlowPyrLK().
   *
   * The sparse-to-dense interpolation scheme allows for fast computation of dense optical flow using RLOF (see [Geistert2016]).
   * For this scheme the following steps are applied:
   * -# motion vector seeded at a regular sampled grid are computed. The sparsity of this grid can be configured with setGridStep
   * -# (optinally) errornous motion vectors are filter based on the forward backward confidence. The threshold can be configured
   * with setForwardBackward. The filter is only applied if the threshold >0 but than the runtime is doubled due to the estimation
   * of the backward flow.
   * -# Vector field interpolation is applied to the motion vector set to obtain a dense vector field.
   *
   * For the RLOF configuration see optflow::RLOFOpticalFlowParameter for further details.
   * Parameters have been described in [Senst2012] [Senst2013] [Senst2014] and [Senst2016].
   *
   * **Note:** If the grid size is set to (1,1) and the forward backward threshold <= 0 than pixelwise dense optical flow field is
   * computed by RLOF without using interpolation.
   *
   * **Note:** Note that in output, if no correspondences are found between \a I0 and \a I1, the \a flow is set to 0.
   * See: optflow::calcOpticalFlowDenseRLOF(), optflow::RLOFOpticalFlowParameter
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/optflow/include/opencv2/optflow/rlofflow.hpp#L233
   */
  DenseRLOFOpticalFlow: AugmentedModule['optflow_DenseRLOFOpticalFlow']
/**
   * Class used for calculation sparse optical flow and feature tracking with robust local optical flow (RLOF) algorithms.
   *
   * The RLOF is a fast local optical flow approach described in [Senst2012] [Senst2013] [Senst2014]
   * and [Senst2016] similar to the pyramidal iterative Lucas-Kanade method as
   * proposed by [Bouguet00]. More details and experiments can be found in the following thesis [Senst2019].
   * The implementation is derived from optflow::calcOpticalFlowPyrLK().
   *
   * For the RLOF configuration see optflow::RLOFOpticalFlowParameter for further details.
   * Parameters have been described in [Senst2012], [Senst2013], [Senst2014] and [Senst2016].
   *
   * **Note:** SIMD parallelization is only available when compiling with SSE4.1.
   * See: optflow::calcOpticalFlowSparseRLOF(), optflow::RLOFOpticalFlowParameter
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/optflow/include/opencv2/optflow/rlofflow.hpp#L412
   */
  SparseRLOFOpticalFlow: AugmentedModule['optflow_SparseRLOFOpticalFlow']
/**
   * optflow gpcpatch descriptor value in the OpenCV API.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/optflow/include/opencv2/optflow/sparse_matching_gpc.hpp#L65
   */
  GPCPatchDescriptor: AugmentedModule['optflow_GPCPatchDescriptor']
/**
   * optflow gpcpatch sample value in the OpenCV API.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/optflow/include/opencv2/optflow/sparse_matching_gpc.hpp#L77
   */
  GPCPatchSample: AugmentedModule['optflow_GPCPatchSample']
/**
   * Class encapsulating training samples.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/optflow/include/opencv2/optflow/sparse_matching_gpc.hpp#L98
   */
  GPCTrainingSamples: AugmentedModule['optflow_GPCTrainingSamples']
/**
   * Class for individual tree.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/optflow/include/opencv2/optflow/sparse_matching_gpc.hpp#L154
   */
  GPCTree: AugmentedModule['optflow_GPCTree']
/**
   * Find correspondences between two images.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/optflow/include/opencv2/optflow/sparse_matching_gpc.hpp#L301
   */
  GPCDetails: AugmentedModule['optflow_GPCDetails']
/**
   * Native enum entries for optflow support region type. Pass an entry to enum-typed arguments or its .value to numeric arguments.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/optflow/include/opencv2/optflow/rlofflow.hpp#L17
   */
  SupportRegionType: AugmentedModule['optflow_SupportRegionType']
/**
   * Native enum entries for optflow solver type. Pass an entry to enum-typed arguments or its .value to numeric arguments.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/optflow/include/opencv2/optflow/rlofflow.hpp#L23
   */
  SolverType: AugmentedModule['optflow_SolverType']
/**
   * Native enum entries for optflow interpolation type. Pass an entry to enum-typed arguments or its .value to numeric arguments.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/optflow/include/opencv2/optflow/rlofflow.hpp#L30
   */
  InterpolationType: AugmentedModule['optflow_InterpolationType']
/**
   * Descriptor types for the Global Patch Collider.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/optflow/include/opencv2/optflow/sparse_matching_gpc.hpp#L90
   */
  GPCDescType: AugmentedModule['optflow_GPCDescType']
/**
   * Apply a constant support region
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/optflow/include/opencv2/optflow/rlofflow.hpp#L18
   */
  SR_FIXED: AugmentedModule['optflow_SR_FIXED']
/**
   * Apply a adaptive support region obtained by cross-based segmentation
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/optflow/include/opencv2/optflow/rlofflow.hpp#L19
   */
  SR_CROSS: AugmentedModule['optflow_SR_CROSS']
/**
   * Apply standard iterative refinement
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/optflow/include/opencv2/optflow/rlofflow.hpp#L24
   */
  ST_STANDART: AugmentedModule['optflow_ST_STANDART']
/**
   * Apply optimized iterative refinement based bilinear equation solutions
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/optflow/include/opencv2/optflow/rlofflow.hpp#L25
   */
  ST_BILINEAR: AugmentedModule['optflow_ST_BILINEAR']
/**
   * Fast geodesic interpolation, see [Geistert2016]
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/optflow/include/opencv2/optflow/rlofflow.hpp#L32
   */
  INTERP_GEO: AugmentedModule['optflow_INTERP_GEO']
/**
   * Edge-preserving interpolation using ximgproc::EdgeAwareInterpolator, see [Revaud2015],Geistert2016.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/optflow/include/opencv2/optflow/rlofflow.hpp#L33
   */
  INTERP_EPIC: AugmentedModule['optflow_INTERP_EPIC']
/**
   * SLIC based robust interpolation using ximgproc::RICInterpolator, see [Hu2017].
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/optflow/include/opencv2/optflow/rlofflow.hpp#L34
   */
  INTERP_RIC: AugmentedModule['optflow_INTERP_RIC']
/**
   * Better quality but slow
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/optflow/include/opencv2/optflow/sparse_matching_gpc.hpp#L92
   */
  GPC_DESCRIPTOR_DCT: AugmentedModule['optflow_GPC_DESCRIPTOR_DCT']
/**
   * Worse quality but much faster
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/optflow/include/opencv2/optflow/sparse_matching_gpc.hpp#L93
   */
  GPC_DESCRIPTOR_WHT: AugmentedModule['optflow_GPC_DESCRIPTOR_WHT']
}
  /** Native parallel namespace. */
  parallel: CVNamespace<'parallel'> & {

}
  /** Native phase_unwrapping namespace. */
  phase_unwrapping: CVNamespace<'phase_unwrapping'> & {
/**
   * Parameters of phaseUnwrapping constructor.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/phase_unwrapping/include/opencv2/phase_unwrapping/histogramphaseunwrapping.hpp#L78
   */
  HistogramPhaseUnwrapping_Params: AugmentedModule['phase_unwrapping_HistogramPhaseUnwrapping_Params']
/**
   * Abstract base class for phase unwrapping.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/phase_unwrapping/include/opencv2/phase_unwrapping/phase_unwrapping.hpp#L55
   */
  PhaseUnwrapping: AugmentedModule['phase_unwrapping_PhaseUnwrapping']
/**
   * Class implementing two-dimensional phase unwrapping based on [histogramUnwrapping]
   * This algorithm belongs to the quality-guided phase unwrapping methods.
   * First, it computes a reliability map from second differences between a pixel and its eight neighbours.
   * Reliability values lie between 0 and 16*pi*pi. Then, this reliability map is used to compute
   * the reliabilities of "edges". An edge is an entity defined by two pixels that are connected
   * horizontally or vertically. Its reliability is found by adding the the reliabilities of the
   * two pixels connected through it. Edges are sorted in a histogram based on their reliability values.
   * This histogram is then used to unwrap pixels, starting from the highest quality pixel.
   * The wrapped phase map and the unwrapped result are stored in CV_32FC1 Mat.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/phase_unwrapping/include/opencv2/phase_unwrapping/histogramphaseunwrapping.hpp#L65
   */
  HistogramPhaseUnwrapping: AugmentedModule['phase_unwrapping_HistogramPhaseUnwrapping']
}
  /** Native plot namespace. */
  plot: CVNamespace<'plot'> & {
/**
   * plot plot2d value in the OpenCV API.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/plot/include/opencv2/plot.hpp#L65
   */
  Plot2d: AugmentedModule['plot_Plot2d']
}
  /** Native ppf_match_3d namespace. */
  ppf_match_3d: CVNamespace<'ppf_match_3d'> & {
/**
   * This class implements a very efficient and robust variant of the iterative closest point (ICP) algorithm.
   * The task is to register a 3D model (or point cloud) against a set of noisy target data. The variants are put together
   * by myself after certain tests. The task is to be able to match partial, noisy point clouds in cluttered scenes, quickly.
   * You will find that my emphasis is on the performance, while retaining the accuracy.
   * This implementation is based on Tolga Birdal's MATLAB implementation in here:
   * http://www.mathworks.com/matlabcentral/fileexchange/47152-icp-registration-using-efficient-variants-and-multi-resolution-scheme
   * The main contributions come from:
   * 1. Picky ICP:
   * http://www5.informatik.uni-erlangen.de/Forschung/Publikationen/2003/Zinsser03-ARI.pdf
   * 2. Efficient variants of the ICP Algorithm:
   * http://docs.happycoders.org/orgadoc/graphics/imaging/fasticp_paper.pdf
   * 3. Geometrically Stable Sampling for the ICP Algorithm: https://graphics.stanford.edu/papers/stabicp/stabicp.pdf
   * 4. Multi-resolution registration:
   * http://www.cvl.iis.u-tokyo.ac.jp/~oishi/Papers/Alignment/Jost_MultiResolutionICP_3DIM03.pdf
   * 5. Linearization of Point-to-Plane metric by Kok Lim Low:
   * https://www.comp.nus.edu.sg/~lowkl/publications/lowk_point-to-plane_icp_techrep.pdf
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/surface_matching/include/opencv2/surface_matching/icp.hpp#L80
   */
  ICP: AugmentedModule['ppf_match_3d_ICP']
/**
   * Class, allowing the storage of a pose. The data structure stores both
   * the quaternions and the matrix forms. It supports IO functionality together with
   * various helper methods to work with poses
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/surface_matching/include/opencv2/surface_matching/pose_3d.hpp#L70
   */
  Pose3D: AugmentedModule['ppf_match_3d_Pose3D']
/**
   * When multiple poses (see Pose3D) are grouped together (contribute to the same transformation)
   * pose clusters occur. This class is a general container for such groups of poses. It is possible to store,
   * load and perform IO on these poses.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/surface_matching/include/opencv2/surface_matching/pose_3d.hpp#L138
   */
  PoseCluster3D: AugmentedModule['ppf_match_3d_PoseCluster3D']
/**
   * Class, allowing the load and matching 3D models.
   * Typical Use:
   *
   * ```cpp
   * // Train a model
   * ppf_match_3d::PPF3DDetector detector(0.05, 0.05);
   * detector.trainModel(pc);
   * // Search the model in a given scene
   * vector<Pose3DPtr> results;
   * detector.match(pcTest, results, 1.0/5.0,0.05);
   *
   * ```
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/surface_matching/include/opencv2/surface_matching/ppf_match_3d.hpp#L97
   */
  PPF3DDetector: AugmentedModule['ppf_match_3d_PPF3DDetector']
}
  /** Native quality namespace. */
  quality: CVNamespace<'quality'> & {
/**
   * Quality Base Class ***********************************
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/quality/include/opencv2/quality/qualitybase.hpp#L23
   */
  QualityBase: AugmentedModule['quality_QualityBase']
/**
   * BRISQUE (Blind/Referenceless Image Spatial Quality Evaluator) is a No Reference Image Quality Assessment (NR-IQA) algorithm.
   *
   * BRISQUE computes a score based on extracting Natural Scene Statistics (https://en.wikipedia.org/wiki/Scene_statistics)
   * and calculating feature vectors. See Mittal et al. [Mittal2] for original paper and original implementation [Mittal2_software] .
   *
   * A trained model is provided in the /samples/ directory and is trained on the LIVE-R2 database [Sheikh] as in the original implementation.
   * When evaluated against the TID2008 database [Ponomarenko] , the SROCC is -0.8424 versus the SROCC of -0.8354 in the original implementation.
   * C++ code for the BRISQUE LIVE-R2 trainer and TID2008 evaluator are also provided in the /samples/ directory.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/quality/include/opencv2/quality/qualitybrisque.hpp#L26
   */
  QualityBRISQUE: AugmentedModule['quality_QualityBRISQUE']
/**
   * Full reference GMSD algorithm
   * http://www4.comp.polyu.edu.hk/~cslzhang/IQA/GMSD/GMSD.htm
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/quality/include/opencv2/quality/qualitygmsd.hpp#L19
   */
  QualityGMSD: AugmentedModule['quality_QualityGMSD']
/**
   * Full reference mean square error algorithm  https://en.wikipedia.org/wiki/Mean_squared_error
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/quality/include/opencv2/quality/qualitymse.hpp#L18
   */
  QualityMSE: AugmentedModule['quality_QualityMSE']
/**
   * Full reference peak signal to noise ratio (PSNR) algorithm  https://en.wikipedia.org/wiki/Peak_signal-to-noise_ratio
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/quality/include/opencv2/quality/qualitypsnr.hpp#L20
   */
  QualityPSNR: AugmentedModule['quality_QualityPSNR']
/**
   * Full reference structural similarity algorithm  https://en.wikipedia.org/wiki/Structural_similarity
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/quality/include/opencv2/quality/qualityssim.hpp#L18
   */
  QualitySSIM: AugmentedModule['quality_QualitySSIM']
}
  /** Native rapid namespace. */
  rapid: CVNamespace<'rapid'> & {
/**
   * Abstract base class for stateful silhouette trackers
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/rapid/include/opencv2/rapid.hpp#L127
   */
  Tracker: AugmentedModule['rapid_Tracker']
/**
   * wrapper around `rapid` function for uniform access
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/rapid/include/opencv2/rapid.hpp#L138
   */
  Rapid: AugmentedModule['rapid_Rapid']
/**
   * implements "Optimal local searching for fast and robust textureless 3D object tracking in highly
   * cluttered backgrounds" [seo2013optimal]
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/rapid/include/opencv2/rapid.hpp#L147
   */
  OLSTracker: AugmentedModule['rapid_OLSTracker']
/**
   * implements "Global optimal searching for textureless 3D object tracking" [wang2015global]
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/rapid/include/opencv2/rapid.hpp#L155
   */
  GOSTracker: AugmentedModule['rapid_GOSTracker']
}
  /** Native reg namespace. */
  reg: CVNamespace<'reg'> & {
/**
   * Base class for modelling a Map between two images.
   *
   * The class is only used to define the common interface for any possible map.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/reg/include/opencv2/reg/map.hpp#L124
   */
  Map: AugmentedModule['reg_Map']
/**
   * Defines an affine transformation
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/reg/include/opencv2/reg/mapaffine.hpp#L52
   */
  MapAffine: AugmentedModule['reg_MapAffine']
/**
   * Base class for modelling an algorithm for calculating a map
   *
   * The class is only used to define the common interface for any possible mapping algorithm.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/reg/include/opencv2/reg/mapper.hpp#L54
   */
  Mapper: AugmentedModule['reg_Mapper']
/**
   * Mapper for affine motion
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/reg/include/opencv2/reg/mappergradaffine.hpp#L52
   */
  MapperGradAffine: AugmentedModule['reg_MapperGradAffine']
/**
   * Mapper for euclidean motion: rotation plus shift
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/reg/include/opencv2/reg/mappergradeuclid.hpp#L52
   */
  MapperGradEuclid: AugmentedModule['reg_MapperGradEuclid']
/**
   * Gradient mapper for a projective transformation
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/reg/include/opencv2/reg/mappergradproj.hpp#L52
   */
  MapperGradProj: AugmentedModule['reg_MapperGradProj']
/**
   * Gradient mapper for a translation
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/reg/include/opencv2/reg/mappergradshift.hpp#L52
   */
  MapperGradShift: AugmentedModule['reg_MapperGradShift']
/**
   * Calculates a similarity transformation between to images (scale, rotation, and shift)
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/reg/include/opencv2/reg/mappergradsimilar.hpp#L52
   */
  MapperGradSimilar: AugmentedModule['reg_MapperGradSimilar']
/**
   * Calculates a map using a gaussian pyramid
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/reg/include/opencv2/reg/mapperpyramid.hpp#L55
   */
  MapperPyramid: AugmentedModule['reg_MapperPyramid']
/**
   * Converts a pointer to a Map returned by MapperPyramid::calculate into the specified Map pointer type
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/reg/include/opencv2/reg/mapperpyramid.hpp#L79
   */
  MapTypeCaster: AugmentedModule['reg_MapTypeCaster']
/**
   * Defines an transformation that consists on a projective transformation
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/reg/include/opencv2/reg/mapprojec.hpp#L53
   */
  MapProjec: AugmentedModule['reg_MapProjec']
/**
   * Defines an transformation that consists on a simple displacement
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/reg/include/opencv2/reg/mapshift.hpp#L53
   */
  MapShift: AugmentedModule['reg_MapShift']
}
  /** Native saliency namespace. */
  saliency: CVNamespace<'saliency'> & {
/**
   * Saliency Base Class ***********************************
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/saliency/include/opencv2/saliency/saliencyBaseClasses.hpp#L62
   */
  Saliency: AugmentedModule['saliency_Saliency']
/**
   * Static Saliency Base Class ***********************************
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/saliency/include/opencv2/saliency/saliencyBaseClasses.hpp#L85
   */
  StaticSaliency: AugmentedModule['saliency_StaticSaliency']
/**
   * Motion Saliency Base Class ***********************************
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/saliency/include/opencv2/saliency/saliencyBaseClasses.hpp#L111
   */
  MotionSaliency: AugmentedModule['saliency_MotionSaliency']
/**
   * Objectness Base Class ***********************************
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/saliency/include/opencv2/saliency/saliencyBaseClasses.hpp#L120
   */
  Objectness: AugmentedModule['saliency_Objectness']
/**
   * Specific Static Saliency Specialized Classes ***********************************
   * the Spectral Residual approach from  [SR]
   *
   * Starting from the principle of natural image statistics, this method simulate the behavior of
   * pre-attentive visual search. The algorithm analyze the log spectrum of each image and obtain the
   * spectral residual. Then transform the spectral residual to spatial domain to obtain the saliency
   * map, which suggests the positions of proto-objects.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/saliency/include/opencv2/saliency/saliencySpecializedClasses.hpp#L69
   */
  StaticSaliencySpectralResidual: AugmentedModule['saliency_StaticSaliencySpectralResidual']
/**
   * the Fine Grained Saliency approach from [FGS]
   *
   * This method calculates saliency based on center-surround differences.
   * High resolution saliency maps are generated in real time by using integral images.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/saliency/include/opencv2/saliency/saliencySpecializedClasses.hpp#L122
   */
  StaticSaliencyFineGrained: AugmentedModule['saliency_StaticSaliencyFineGrained']
/**
   * Specific Motion Saliency Specialized Classes ***********************************
   * A Fast Self-tuning Background Subtraction Algorithm.
   *
   * This background subtraction algorithm is inspired to the work of B. Wang and P. Dudek [2]
   * [2]  B. Wang and P. Dudek "A Fast Self-tuning Background Subtraction Algorithm", in proc of IEEE Workshop on Change Detection, 2014
   *
   * the Fast Self-tuning Background Subtraction Algorithm from [BinWangApr2014]
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/saliency/include/opencv2/saliency/saliencySpecializedClasses.hpp#L169
   */
  MotionSaliencyBinWangApr2014: AugmentedModule['saliency_MotionSaliencyBinWangApr2014']
/**
   * Specific Objectness Specialized Classes ***********************************
   * Objectness algorithms based on [3]
   * [3] Cheng, Ming-Ming, et al. "BING: Binarized normed gradients for objectness estimation at 300fps." IEEE CVPR. 2014.
   * the Binarized normed gradients algorithm from [BING]
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/saliency/include/opencv2/saliency/saliencySpecializedClasses.hpp#L291
   */
  ObjectnessBING: AugmentedModule['saliency_ObjectnessBING']
}
  /** Native samples namespace. */
  samples: CVNamespace<'samples'> & {

}
  /** Native segmentation namespace. */
  segmentation: CVNamespace<'segmentation'> & {
/**
   * Intelligent Scissors image segmentation
   *
   * This class is used to find the path (contour) between two points
   * which can be used for image segmentation.
   *
   * Usage example:
   *
   * Reference: <a href="http://citeseerx.ist.psu.edu/viewdoc/download?doi=10.1.1.138.3811&rep=rep1&type=pdf">"Intelligent Scissors for Image Composition"</a>
   * algorithm designed by Eric N. Mortensen and William A. Barrett, Brigham Young University
   * [Mortensen95intelligentscissors]
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/photo/include/opencv2/photo/segmentation.hpp#L30
   */
  IntelligentScissorsMB: AugmentedModule['segmentation_IntelligentScissorsMB']
}
  /** Native sfm namespace. */
  sfm: CVNamespace<'sfm'> & {
/**
   * Data structure describing the camera model and its parameters.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/sfm/include/opencv2/sfm/simple_pipeline.hpp#L72
   */
  libmv_CameraIntrinsicsOptions: AugmentedModule['sfm_libmv_CameraIntrinsicsOptions']
/**
   * Data structure describing the reconstruction options.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/sfm/include/opencv2/sfm/simple_pipeline.hpp#L140
   */
  libmv_ReconstructionOptions: AugmentedModule['sfm_libmv_ReconstructionOptions']
/**
   * base class BaseSFM declares a common API that would be used in a typical scene reconstruction scenario
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/sfm/include/opencv2/sfm/simple_pipeline.hpp#L163
   */
  BaseSFM: AugmentedModule['sfm_BaseSFM']
/**
   * SFMLibmvEuclideanReconstruction class provides an interface with the Libmv Structure From Motion pipeline.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/sfm/include/opencv2/sfm/simple_pipeline.hpp#L195
   */
  SFMLibmvEuclideanReconstruction: AugmentedModule['sfm_SFMLibmvEuclideanReconstruction']
/**
   * sfm sfm io bundler constant (0), defined by OpenCV for cv::sfm.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/sfm/include/opencv2/sfm/io.hpp#L58
   */
  SFM_IO_BUNDLER: AugmentedModule['sfm_SFM_IO_BUNDLER']
/**
   * sfm sfm io visualsfm constant (1), defined by OpenCV for cv::sfm.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/sfm/include/opencv2/sfm/io.hpp#L59
   */
  SFM_IO_VISUALSFM: AugmentedModule['sfm_SFM_IO_VISUALSFM']
/**
   * sfm sfm io opensfm constant (2), defined by OpenCV for cv::sfm.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/sfm/include/opencv2/sfm/io.hpp#L60
   */
  SFM_IO_OPENSFM: AugmentedModule['sfm_SFM_IO_OPENSFM']
/**
   * sfm sfm io openmvg constant (3), defined by OpenCV for cv::sfm.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/sfm/include/opencv2/sfm/io.hpp#L61
   */
  SFM_IO_OPENMVG: AugmentedModule['sfm_SFM_IO_OPENMVG']
/**
   * sfm sfm io theiasfm constant (4), defined by OpenCV for cv::sfm.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/sfm/include/opencv2/sfm/io.hpp#L62
   */
  SFM_IO_THEIASFM: AugmentedModule['sfm_SFM_IO_THEIASFM']
/**
   * LIBMV_DISTORTION_MODEL_POLYNOMIAL
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/sfm/include/opencv2/sfm/simple_pipeline.hpp#L52
   */
  SFM_DISTORTION_MODEL_POLYNOMIAL: AugmentedModule['sfm_SFM_DISTORTION_MODEL_POLYNOMIAL']
/**
   * LIBMV_DISTORTION_MODEL_DIVISION
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/sfm/include/opencv2/sfm/simple_pipeline.hpp#L53
   */
  SFM_DISTORTION_MODEL_DIVISION: AugmentedModule['sfm_SFM_DISTORTION_MODEL_DIVISION']
/**
   * libmv::BUNDLE_FOCAL_LENGTH
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/sfm/include/opencv2/sfm/simple_pipeline.hpp#L126
   */
  SFM_REFINE_FOCAL_LENGTH: AugmentedModule['sfm_SFM_REFINE_FOCAL_LENGTH']
/**
   * libmv::BUNDLE_PRINCIPAL_POINT
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/sfm/include/opencv2/sfm/simple_pipeline.hpp#L127
   */
  SFM_REFINE_PRINCIPAL_POINT: AugmentedModule['sfm_SFM_REFINE_PRINCIPAL_POINT']
/**
   * libmv::BUNDLE_RADIAL_K1
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/sfm/include/opencv2/sfm/simple_pipeline.hpp#L128
   */
  SFM_REFINE_RADIAL_DISTORTION_K1: AugmentedModule['sfm_SFM_REFINE_RADIAL_DISTORTION_K1']
/**
   * libmv::BUNDLE_RADIAL_K2
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/sfm/include/opencv2/sfm/simple_pipeline.hpp#L129
   */
  SFM_REFINE_RADIAL_DISTORTION_K2: AugmentedModule['sfm_SFM_REFINE_RADIAL_DISTORTION_K2']
}
  /** Native signal namespace. */
  signal: CVNamespace<'signal'> & {

}
  /** Native std namespace. */
  std: CVNamespace<'std'> & {
/**
   * An owned native vector. Append values with push_back, read them with get, and release the vector with using or delete(). Native object elements returned by get require separate disposal.
   */
  _vector_cv__MatVector: AugmentedModule['std__vector_cv__MatVector']
/**
   * An owned native vector. Append values with push_back, read them with get, and release the vector with using or delete(). Native object elements returned by get require separate disposal.
   */
  _vector_cv__Point2fVector: AugmentedModule['std__vector_cv__Point2fVector']
/**
   * An owned native vector. Append values with push_back, read them with get, and release the vector with using or delete(). Native object elements returned by get require separate disposal.
   */
  _vector_cv__line_descriptor__KeyLineVector: AugmentedModule['std__vector_cv__line_descriptor__KeyLineVector']
/**
   * An owned native vector. Append values with push_back, read them with get, and release the vector with using or delete(). Native object elements returned by get require separate disposal.
   */
  _vector_cv__Point3fVector: AugmentedModule['std__vector_cv__Point3fVector']
/**
   * An owned native vector. Append values with push_back, read them with get, and release the vector with using or delete(). Native object elements returned by get require separate disposal.
   */
  _vector_ucharVector: AugmentedModule['std__vector_ucharVector']
/**
   * An owned native vector. Append values with push_back, read them with get, and release the vector with using or delete(). Native object elements returned by get require separate disposal.
   */
  _pair_int__doubleVector: AugmentedModule['std__pair_int__doubleVector']
}
  /** Native stereo namespace. */
  stereo: CVNamespace<'stereo'> & {
/**
   * An owned native vector. Append values with push_back, read them with get, and release the vector with using or delete(). Native object elements returned by get require separate disposal.
   */
  _MatchQuasiDenseVector: AugmentedModule['stereo__MatchQuasiDenseVector']
/**
   * \addtogroup xstereo
   *  
   * A basic match structure
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xstereo/include/opencv2/xstereo/quasi_dense_stereo.hpp#L27
   */
  MatchQuasiDense: AugmentedModule['stereo_MatchQuasiDense']
/**
   * stereo propagation parameters value in the OpenCV API.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xstereo/include/opencv2/xstereo/quasi_dense_stereo.hpp#L40
   */
  PropagationParameters: AugmentedModule['stereo_PropagationParameters']
/**
   * Class containing the methods needed for Quasi Dense Stereo computation.
   *
   * This module contains the code to perform quasi dense stereo matching.
   * The method initially starts with a sparse 3D reconstruction based on feature matching across a
   * stereo image pair and subsequently propagates the structure into neighboring image regions.
   * To obtain initial seed correspondences, the algorithm locates Shi and Tomashi features in the
   * left image of the stereo pair and then tracks them using pyramidal Lucas-Kanade in the right image.
   * To densify the sparse correspondences, the algorithm computes the zero-mean normalized
   * cross-correlation (ZNCC) in small patches around every seed pair and uses it as a quality metric
   * for each match. In this code, we introduce a custom structure to store the location and ZNCC value
   * of correspondences called "Match". Seed Matches are stored in a priority queue sorted according to
   * their ZNCC value, allowing for the best quality Match to be readily available. The algorithm pops
   * Matches and uses them to extract new matches around them. This is done by considering a small
   * neighboring area around each Seed and retrieving correspondences above a certain texture threshold
   * that are not previously computed. New matches are stored in the seed priority queue and used as seeds.
   * The propagation process ends when no additional matches can be retrieved.
   *
   * See: This code represents the work presented in [Stoyanov2010].
   * If this code is useful for your work please cite [Stoyanov2010].
   *
   * Also the original growing scheme idea is described in [Lhuillier2000]
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xstereo/include/opencv2/xstereo/quasi_dense_stereo.hpp#L95
   */
  QuasiDenseStereo: AugmentedModule['stereo_QuasiDenseStereo']
/**
   * stereo cv speckle removal algorithm constant (0), defined by OpenCV for cv::stereo.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xstereo/include/opencv2/xstereo.hpp#L66
   */
  CV_SPECKLE_REMOVAL_ALGORITHM: AugmentedModule['stereo_CV_SPECKLE_REMOVAL_ALGORITHM']
/**
   * stereo cv speckle removal avg algorithm constant (1), defined by OpenCV for cv::stereo.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xstereo/include/opencv2/xstereo.hpp#L66
   */
  CV_SPECKLE_REMOVAL_AVG_ALGORITHM: AugmentedModule['stereo_CV_SPECKLE_REMOVAL_AVG_ALGORITHM']
/**
   * stereo cv quadratic interpolation constant (0), defined by OpenCV for cv::stereo.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xstereo/include/opencv2/xstereo.hpp#L70
   */
  CV_QUADRATIC_INTERPOLATION: AugmentedModule['stereo_CV_QUADRATIC_INTERPOLATION']
/**
   * stereo cv simetricv interpolation constant (1), defined by OpenCV for cv::stereo.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xstereo/include/opencv2/xstereo.hpp#L70
   */
  CV_SIMETRICV_INTERPOLATION: AugmentedModule['stereo_CV_SIMETRICV_INTERPOLATION']
/**
   * stereo stereo binary bm prefilter normalized response constant (0), defined by OpenCV for cv::stereo::StereoBinaryBM.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xstereo/include/opencv2/xstereo.hpp#L78
   */
  StereoBinaryBM_PREFILTER_NORMALIZED_RESPONSE: AugmentedModule['stereo_StereoBinaryBM_PREFILTER_NORMALIZED_RESPONSE']
/**
   * stereo stereo binary bm prefilter normalized response constant (0), defined by OpenCV for cv::stereo::StereoBinaryBM.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xstereo/include/opencv2/xstereo.hpp#L78
   */
  STEREO_BINARY_BM_PREFILTER_NORMALIZED_RESPONSE: AugmentedModule['stereo_STEREO_BINARY_BM_PREFILTER_NORMALIZED_RESPONSE']
/**
   * stereo stereo binary bm prefilter xsobel constant (1), defined by OpenCV for cv::stereo::StereoBinaryBM.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xstereo/include/opencv2/xstereo.hpp#L79
   */
  StereoBinaryBM_PREFILTER_XSOBEL: AugmentedModule['stereo_StereoBinaryBM_PREFILTER_XSOBEL']
/**
   * stereo stereo binary bm prefilter xsobel constant (1), defined by OpenCV for cv::stereo::StereoBinaryBM.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xstereo/include/opencv2/xstereo.hpp#L79
   */
  STEREO_BINARY_BM_PREFILTER_XSOBEL: AugmentedModule['stereo_STEREO_BINARY_BM_PREFILTER_XSOBEL']
/**
   * stereo stereo binary sgbm mode sgbm constant (0), defined by OpenCV for cv::stereo::StereoBinarySGBM.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xstereo/include/opencv2/xstereo.hpp#L153
   */
  StereoBinarySGBM_MODE_SGBM: AugmentedModule['stereo_StereoBinarySGBM_MODE_SGBM']
/**
   * stereo stereo binary sgbm mode sgbm constant (0), defined by OpenCV for cv::stereo::StereoBinarySGBM.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xstereo/include/opencv2/xstereo.hpp#L153
   */
  STEREO_BINARY_SGBM_MODE_SGBM: AugmentedModule['stereo_STEREO_BINARY_SGBM_MODE_SGBM']
/**
   * stereo stereo binary sgbm mode hh constant (1), defined by OpenCV for cv::stereo::StereoBinarySGBM.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xstereo/include/opencv2/xstereo.hpp#L154
   */
  StereoBinarySGBM_MODE_HH: AugmentedModule['stereo_StereoBinarySGBM_MODE_HH']
/**
   * stereo stereo binary sgbm mode hh constant (1), defined by OpenCV for cv::stereo::StereoBinarySGBM.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xstereo/include/opencv2/xstereo.hpp#L154
   */
  STEREO_BINARY_SGBM_MODE_HH: AugmentedModule['stereo_STEREO_BINARY_SGBM_MODE_HH']
/**
   * stereo cv dense census constant (0), defined by OpenCV for cv::stereo.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xstereo/include/opencv2/xstereo/descriptor.hpp#L13
   */
  CV_DENSE_CENSUS: AugmentedModule['stereo_CV_DENSE_CENSUS']
/**
   * stereo cv sparse census constant (1), defined by OpenCV for cv::stereo.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xstereo/include/opencv2/xstereo/descriptor.hpp#L13
   */
  CV_SPARSE_CENSUS: AugmentedModule['stereo_CV_SPARSE_CENSUS']
/**
   * stereo cv cs census constant (2), defined by OpenCV for cv::stereo.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xstereo/include/opencv2/xstereo/descriptor.hpp#L14
   */
  CV_CS_CENSUS: AugmentedModule['stereo_CV_CS_CENSUS']
/**
   * stereo cv modified cs census constant (3), defined by OpenCV for cv::stereo.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xstereo/include/opencv2/xstereo/descriptor.hpp#L14
   */
  CV_MODIFIED_CS_CENSUS: AugmentedModule['stereo_CV_MODIFIED_CS_CENSUS']
/**
   * stereo cv modified census transform constant (4), defined by OpenCV for cv::stereo.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xstereo/include/opencv2/xstereo/descriptor.hpp#L14
   */
  CV_MODIFIED_CENSUS_TRANSFORM: AugmentedModule['stereo_CV_MODIFIED_CENSUS_TRANSFORM']
/**
   * stereo cv mean variation constant (5), defined by OpenCV for cv::stereo.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xstereo/include/opencv2/xstereo/descriptor.hpp#L15
   */
  CV_MEAN_VARIATION: AugmentedModule['stereo_CV_MEAN_VARIATION']
/**
   * stereo cv star kernel constant (6), defined by OpenCV for cv::stereo.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xstereo/include/opencv2/xstereo/descriptor.hpp#L15
   */
  CV_STAR_KERNEL: AugmentedModule['stereo_CV_STAR_KERNEL']
}
  /** Native structured_light namespace. */
  structured_light: CVNamespace<'structured_light'> & {
/**
   * Parameters of SinusoidalPattern constructor
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/structured_light/include/opencv2/structured_light/sinusoidalpattern.hpp#L82
   */
  SinusoidalPattern_Params: AugmentedModule['structured_light_SinusoidalPattern_Params']
/**
   * Abstract base class for generating and decoding structured light patterns.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/structured_light/include/opencv2/structured_light/structured_light.hpp#L61
   */
  StructuredLightPattern: AugmentedModule['structured_light_StructuredLightPattern']
/**
   * Class implementing the Gray-code pattern, based on [UNDERWORLD].
   *
   *  The generation of the pattern images is performed with Gray encoding using the traditional white and black colors.
   *
   *  The information about the two image axes x, y is encoded separately into two different pattern sequences.
   *  A projector P with resolution (P_res_x, P_res_y) will result in Ncols = log 2 (P_res_x) encoded pattern images representing the columns, and
   *  in Nrows = log 2 (P_res_y) encoded pattern images representing the rows.
   *  For example a projector with resolution 1024x768 will result in Ncols = 10 and Nrows = 10.
   *  However, the generated pattern sequence consists of both regular color and color-inverted images: inverted pattern images are images
   *  with the same structure as the original but with inverted colors.
   *  This provides an effective method for easily determining the intensity value of each pixel when it is lit (highest value) and
   *  when it is not lit (lowest value). So for a a projector with resolution 1024x768, the number of pattern images will be Ncols * 2 + Nrows * 2 = 40.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/structured_light/include/opencv2/structured_light/graycodepattern.hpp#L68
   */
  GrayCodePattern: AugmentedModule['structured_light_GrayCodePattern']
/**
   * Class implementing Fourier transform profilometry (FTP) , phase-shifting profilometry (PSP)
   * and Fourier-assisted phase-shifting profilometry (FAPS) based on [faps].
   * This class generates sinusoidal patterns that can be used with FTP, PSP and FAPS.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/structured_light/include/opencv2/structured_light/sinusoidalpattern.hpp#L68
   */
  SinusoidalPattern: AugmentedModule['structured_light_SinusoidalPattern']
/**
   * structured light ftp constant (0), defined by OpenCV for cv::structured_light.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/structured_light/include/opencv2/structured_light/sinusoidalpattern.hpp#L58
   */
  FTP: AugmentedModule['structured_light_FTP']
/**
   * structured light psp constant (1), defined by OpenCV for cv::structured_light.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/structured_light/include/opencv2/structured_light/sinusoidalpattern.hpp#L59
   */
  PSP: AugmentedModule['structured_light_PSP']
/**
   * structured light faps constant (2), defined by OpenCV for cv::structured_light.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/structured_light/include/opencv2/structured_light/sinusoidalpattern.hpp#L60
   */
  FAPS: AugmentedModule['structured_light_FAPS']
/**
   * Kyriakos Herakleous, Charalambos Poullis. "3DUNDERWORLD-SLS: An Open-Source Structured-Light Scanning System for Rapid Geometry Acquisition", arXiv preprint arXiv:1406.6595 (2014).
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/structured_light/include/opencv2/structured_light/structured_light.hpp#L56
   */
  DECODE_3D_UNDERWORLD: AugmentedModule['structured_light_DECODE_3D_UNDERWORLD']
}
  /** Native text namespace. */
  text: CVNamespace<'text'> & {
/**
   * Base class for 1st and 2nd stages of Neumann and Matas scene text detection algorithm [Neumann12]. :
   *
   * Extracts the component tree (if needed) and filter the extremal regions (ER's) by using a given classifier.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/text/include/opencv2/text/erfilter.hpp#L118
   */
  ERFilter: AugmentedModule['text_ERFilter']
/**
   * Callback with the classifier is made a class.
   *
   *     By doing it we hide SVM, Boost etc. Developers can provide their own classifiers to the
   *     ERFilter algorithm.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/text/include/opencv2/text/erfilter.hpp#L127
   */
  ERFilter_Callback: AugmentedModule['text_ERFilter_Callback']
/**
   * base class BaseOCR declares a common API that would be used in a typical text recognition scenario
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/text/include/opencv2/text/ocr.hpp#L92
   */
  BaseOCR: AugmentedModule['text_BaseOCR']
/**
   * OCRTesseract class provides an interface with the tesseract-ocr API (v3.02.02) in C++.
   *
   * Notice that it is compiled only when tesseract-ocr is correctly installed.
   *
   * **Note:** -   (C++) An example of OCRTesseract recognition combined with scene text detection can be found
   *         at the end_to_end_recognition demo:
   *         <https://github.com/opencv/opencv_contrib/blob/master/modules/text/samples/end_to_end_recognition.cpp>
   *     -   (C++) Another example of OCRTesseract recognition combined with scene text detection can be
   *         found at the webcam_demo:
   *         <https://github.com/opencv/opencv_contrib/blob/master/modules/text/samples/webcam_demo.cpp>
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/text/include/opencv2/text/ocr.hpp#L116
   */
  OCRTesseract: AugmentedModule['text_OCRTesseract']
/**
   * OCRHMMDecoder class provides an interface for OCR using Hidden Markov Models.
   *
   * **Note:** -   (C++) An example on using OCRHMMDecoder recognition combined with scene text detection can
   *         be found at the webcam_demo sample:
   *         <https://github.com/opencv/opencv_contrib/blob/master/modules/text/samples/webcam_demo.cpp>
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/text/include/opencv2/text/ocr.hpp#L193
   */
  OCRHMMDecoder: AugmentedModule['text_OCRHMMDecoder']
/**
   * Callback with the character classifier is made a class.
   *
   *     This way it hides the feature extractor and the classifier itself, so developers can write
   *     their own OCR code.
   *
   *     The default character classifier and feature extractor can be loaded using the utility function
   *     loadOCRHMMClassifierNM and KNN model provided in
   *     <https://github.com/opencv/opencv_contrib/blob/master/modules/text/samples/OCRHMM_knn_model_data.xml.gz>.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/text/include/opencv2/text/ocr.hpp#L206
   */
  OCRHMMDecoder_ClassifierCallback: AugmentedModule['text_OCRHMMDecoder_ClassifierCallback']
/**
   * OCR BeamSearch Decoder
   * OCRBeamSearchDecoder class provides an interface for OCR using Beam Search algorithm.
   *
   * **Note:** -   (C++) An example on using OCRBeamSearchDecoder recognition combined with scene text detection can
   *         be found at the demo sample:
   *         <https://github.com/opencv/opencv_contrib/blob/master/modules/text/samples/word_recognition.cpp>
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/text/include/opencv2/text/ocr.hpp#L394
   */
  OCRBeamSearchDecoder: AugmentedModule['text_OCRBeamSearchDecoder']
/**
   * Callback with the character classifier is made a class.
   *
   *     This way it hides the feature extractor and the classifier itself, so developers can write
   *     their own OCR code.
   *
   *     The default character classifier and feature extractor can be loaded using the utility function
   *     loadOCRBeamSearchClassifierCNN with all its parameters provided in
   *     <https://github.com/opencv/opencv_contrib/blob/master/modules/text/samples/OCRBeamSearch_CNN_model_data.xml.gz>.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/text/include/opencv2/text/ocr.hpp#L407
   */
  OCRBeamSearchDecoder_ClassifierCallback: AugmentedModule['text_OCRBeamSearchDecoder_ClassifierCallback']
/**
   * An abstract class providing interface for text detection algorithms
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/text/include/opencv2/text/textDetector.hpp#L20
   */
  TextDetector: AugmentedModule['text_TextDetector']
/**
   * TextDetectorCNN class provides the functionallity of text bounding box detection.
   *  This class is representing to find bounding boxes of text words given an input image.
   *  This class uses OpenCV dnn module to load pre-trained model described in [LiaoSBWL17].
   *  The original repository with the modified SSD Caffe version: https://github.com/MhLiao/TextBoxes.
   *  Model can be downloaded from [DropBox](https://www.dropbox.com/s/g8pjzv2de9gty8g/TextBoxes_icdar13.caffemodel?dl=0).
   *  Modified .prototxt file with the model description can be found in `opencv_contrib/modules/text/samples/textbox.prototxt`.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/text/include/opencv2/text/textDetector.hpp#L41
   */
  TextDetectorCNN: AugmentedModule['text_TextDetectorCNN']
/**
   * text::erGrouping operation modes
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/text/include/opencv2/text/erfilter.hpp#L267
   */
  erGrouping_Modes: AugmentedModule['text_erGrouping_Modes']
/**
   * Tesseract.PageSegMode Enumeration
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/text/include/opencv2/text/ocr.hpp#L67
   */
  page_seg_mode: AugmentedModule['text_page_seg_mode']
/**
   * Tesseract.OcrEngineMode Enumeration
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/text/include/opencv2/text/ocr.hpp#L83
   */
  ocr_engine_mode: AugmentedModule['text_ocr_engine_mode']
/**
   * OCR HMM Decoder
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/text/include/opencv2/text/ocr.hpp#L174
   */
  decoder_mode: AugmentedModule['text_decoder_mode']
/**
   * OCR classifier type
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/text/include/opencv2/text/ocr.hpp#L180
   */
  classifier_type: AugmentedModule['text_classifier_type']
/**
   * computeNMChannels operation modes
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/text/include/opencv2/text/erfilter.hpp#L244
   */
  ERFILTER_NM_RGBLGrad: AugmentedModule['text_ERFILTER_NM_RGBLGrad']
/**
   * computeNMChannels operation modes
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/text/include/opencv2/text/erfilter.hpp#L244
   */
  ERFILTER_NM_RGBLGRAD: AugmentedModule['text_ERFILTER_NM_RGBLGRAD']
/**
   * text erfilter nm ihsgrad constant (1), defined by OpenCV for cv::text.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/text/include/opencv2/text/erfilter.hpp#L245
   */
  ERFILTER_NM_IHSGrad: AugmentedModule['text_ERFILTER_NM_IHSGrad']
/**
   * text erfilter nm ihsgrad constant (1), defined by OpenCV for cv::text.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/text/include/opencv2/text/erfilter.hpp#L245
   */
  ERFILTER_NM_IHSGRAD: AugmentedModule['text_ERFILTER_NM_IHSGRAD']
/**
   * Exhaustive Search algorithm proposed in [Neumann11] for grouping horizontally aligned text.
   *     The algorithm models a verification function for all the possible ER sequences. The
   *     verification fuction for ER pairs consists in a set of threshold-based pairwise rules which
   *     compare measurements of two regions (height ratio, centroid angle, and region distance). The
   *     verification function for ER triplets creates a word text line estimate using Least
   *     Median-Squares fitting for a given triplet and then verifies that the estimate is valid (based
   *     on thresholds created during training). Verification functions for sequences larger than 3 are
   *     approximated by verifying that the text line parameters of all (sub)sequences of length 3 are
   *     consistent.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/text/include/opencv2/text/erfilter.hpp#L279
   */
  ERGROUPING_ORIENTATION_HORIZ: AugmentedModule['text_ERGROUPING_ORIENTATION_HORIZ']
/**
   * Text grouping method proposed in [Gomez13] [Gomez14] for grouping arbitrary oriented text. Regions
   *     are agglomerated by Single Linkage Clustering in a weighted feature space that combines proximity
   *     (x,y coordinates) and similarity measures (color, size, gradient magnitude, stroke width, etc.).
   *     SLC provides a dendrogram where each node represents a text group hypothesis. Then the algorithm
   *     finds the branches corresponding to text groups by traversing this dendrogram with a stopping rule
   *     that combines the output of a rotation invariant text group classifier and a probabilistic measure
   *     for hierarchical clustering validity assessment.
   *
   * **Note:** This mode is not supported due NFA code removal ( https://github.com/opencv/opencv_contrib/issues/2235 )
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/text/include/opencv2/text/erfilter.hpp#L290
   */
  ERGROUPING_ORIENTATION_ANY: AugmentedModule['text_ERGROUPING_ORIENTATION_ANY']
/**
   * text ocr level word constant (0), defined by OpenCV for cv::text.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/text/include/opencv2/text/ocr.hpp#L62
   */
  OCR_LEVEL_WORD: AugmentedModule['text_OCR_LEVEL_WORD']
/**
   * text ocr level textline constant (1), defined by OpenCV for cv::text.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/text/include/opencv2/text/ocr.hpp#L63
   */
  OCR_LEVEL_TEXTLINE: AugmentedModule['text_OCR_LEVEL_TEXTLINE']
/**
   * text psm osd only constant (0), defined by OpenCV for cv::text.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/text/include/opencv2/text/ocr.hpp#L69
   */
  PSM_OSD_ONLY: AugmentedModule['text_PSM_OSD_ONLY']
/**
   * text psm auto osd constant (1), defined by OpenCV for cv::text.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/text/include/opencv2/text/ocr.hpp#L70
   */
  PSM_AUTO_OSD: AugmentedModule['text_PSM_AUTO_OSD']
/**
   * text psm auto only constant (2), defined by OpenCV for cv::text.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/text/include/opencv2/text/ocr.hpp#L71
   */
  PSM_AUTO_ONLY: AugmentedModule['text_PSM_AUTO_ONLY']
/**
   * text psm auto constant (3), defined by OpenCV for cv::text.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/text/include/opencv2/text/ocr.hpp#L72
   */
  PSM_AUTO: AugmentedModule['text_PSM_AUTO']
/**
   * text psm single column constant (4), defined by OpenCV for cv::text.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/text/include/opencv2/text/ocr.hpp#L73
   */
  PSM_SINGLE_COLUMN: AugmentedModule['text_PSM_SINGLE_COLUMN']
/**
   * text psm single block vert text constant (5), defined by OpenCV for cv::text.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/text/include/opencv2/text/ocr.hpp#L74
   */
  PSM_SINGLE_BLOCK_VERT_TEXT: AugmentedModule['text_PSM_SINGLE_BLOCK_VERT_TEXT']
/**
   * text psm single block constant (6), defined by OpenCV for cv::text.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/text/include/opencv2/text/ocr.hpp#L75
   */
  PSM_SINGLE_BLOCK: AugmentedModule['text_PSM_SINGLE_BLOCK']
/**
   * text psm single line constant (7), defined by OpenCV for cv::text.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/text/include/opencv2/text/ocr.hpp#L76
   */
  PSM_SINGLE_LINE: AugmentedModule['text_PSM_SINGLE_LINE']
/**
   * text psm single word constant (8), defined by OpenCV for cv::text.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/text/include/opencv2/text/ocr.hpp#L77
   */
  PSM_SINGLE_WORD: AugmentedModule['text_PSM_SINGLE_WORD']
/**
   * text psm circle word constant (9), defined by OpenCV for cv::text.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/text/include/opencv2/text/ocr.hpp#L78
   */
  PSM_CIRCLE_WORD: AugmentedModule['text_PSM_CIRCLE_WORD']
/**
   * text psm single char constant (10), defined by OpenCV for cv::text.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/text/include/opencv2/text/ocr.hpp#L79
   */
  PSM_SINGLE_CHAR: AugmentedModule['text_PSM_SINGLE_CHAR']
/**
   * text oem tesseract only constant (0), defined by OpenCV for cv::text.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/text/include/opencv2/text/ocr.hpp#L85
   */
  OEM_TESSERACT_ONLY: AugmentedModule['text_OEM_TESSERACT_ONLY']
/**
   * text oem cube only constant (1), defined by OpenCV for cv::text.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/text/include/opencv2/text/ocr.hpp#L86
   */
  OEM_CUBE_ONLY: AugmentedModule['text_OEM_CUBE_ONLY']
/**
   * text oem tesseract cube combined constant (2), defined by OpenCV for cv::text.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/text/include/opencv2/text/ocr.hpp#L87
   */
  OEM_TESSERACT_CUBE_COMBINED: AugmentedModule['text_OEM_TESSERACT_CUBE_COMBINED']
/**
   * text oem default constant (3), defined by OpenCV for cv::text.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/text/include/opencv2/text/ocr.hpp#L88
   */
  OEM_DEFAULT: AugmentedModule['text_OEM_DEFAULT']
/**
   * Other algorithms may be added
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/text/include/opencv2/text/ocr.hpp#L176
   */
  OCR_DECODER_VITERBI: AugmentedModule['text_OCR_DECODER_VITERBI']
/**
   * text ocr knn classifier constant (0), defined by OpenCV for cv::text.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/text/include/opencv2/text/ocr.hpp#L182
   */
  OCR_KNN_CLASSIFIER: AugmentedModule['text_OCR_KNN_CLASSIFIER']
/**
   * text ocr cnn classifier constant (1), defined by OpenCV for cv::text.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/text/include/opencv2/text/ocr.hpp#L183
   */
  OCR_CNN_CLASSIFIER: AugmentedModule['text_OCR_CNN_CLASSIFIER']
}
  /** Native utils namespace. */
  utils: CVNamespace<'utils'> & {
/**
   * utils class with keyword properties value in the OpenCV API.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/bindings_utils.hpp#L238
   */
  ClassWithKeywordProperties: AugmentedModule['utils_ClassWithKeywordProperties']
/**
   * utils function params value in the OpenCV API.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/bindings_utils.hpp#L249
   */
  FunctionParams: AugmentedModule['utils_FunctionParams']
/**
   * utils nested original class name value in the OpenCV API.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/bindings_utils.hpp#L281
   */
  nested_OriginalClassName: AugmentedModule['utils_nested_OriginalClassName']
/**
   * utils nested original class name params value in the OpenCV API.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/bindings_utils.hpp#L284
   */
  nested_OriginalClassName_Params: AugmentedModule['utils_nested_OriginalClassName_Params']
/**
   * Supported logging levels and their semantic
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/utils/logger.defines.hpp#L25
   */
  logging_LogLevel: AugmentedModule['utils_logging_LogLevel']
/**
   * for using in setLogVevel() call
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/utils/logger.defines.hpp#L26
   */
  logging_LOG_LEVEL_SILENT: AugmentedModule['utils_logging_LOG_LEVEL_SILENT']
/**
   * Fatal (critical) error (unrecoverable internal error)
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/utils/logger.defines.hpp#L27
   */
  logging_LOG_LEVEL_FATAL: AugmentedModule['utils_logging_LOG_LEVEL_FATAL']
/**
   * utils_logging_LOG_LEVEL_ERROR: Error message
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/utils/logger.defines.hpp#L28
   */
  logging_LOG_LEVEL_ERROR: AugmentedModule['utils_logging_LOG_LEVEL_ERROR']
/**
   * Warning message
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/utils/logger.defines.hpp#L29
   */
  logging_LOG_LEVEL_WARNING: AugmentedModule['utils_logging_LOG_LEVEL_WARNING']
/**
   * utils_logging_LOG_LEVEL_INFO: Info message
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/utils/logger.defines.hpp#L30
   */
  logging_LOG_LEVEL_INFO: AugmentedModule['utils_logging_LOG_LEVEL_INFO']
/**
   * Debug message. Disabled in the "Release" build.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/utils/logger.defines.hpp#L31
   */
  logging_LOG_LEVEL_DEBUG: AugmentedModule['utils_logging_LOG_LEVEL_DEBUG']
/**
   * Verbose (trace) messages. Requires verbosity level. Disabled in the "Release" build.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/utils/logger.defines.hpp#L32
   */
  logging_LOG_LEVEL_VERBOSE: AugmentedModule['utils_logging_LOG_LEVEL_VERBOSE']
/**
   * utils logging enum log level force int constant (INT_MAX), defined by OpenCV for cv::utils::logging.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/utils/logger.defines.hpp#L34
   */
  logging_ENUM_LOG_LEVEL_FORCE_INT: AugmentedModule['utils_logging_ENUM_LOG_LEVEL_FORCE_INT']
  /** Native utils.fs namespace. */
  fs: CVNamespace<'utils_fs'> & {

}
  /** Native utils.logging namespace. */
  logging: CVNamespace<'utils_logging'> & {
/**
   * Supported logging levels and their semantic
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/utils/logger.defines.hpp#L25
   */
  LogLevel: AugmentedModule['utils_logging_LogLevel']
/**
   * for using in setLogVevel() call
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/utils/logger.defines.hpp#L26
   */
  LOG_LEVEL_SILENT: AugmentedModule['utils_logging_LOG_LEVEL_SILENT']
/**
   * Fatal (critical) error (unrecoverable internal error)
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/utils/logger.defines.hpp#L27
   */
  LOG_LEVEL_FATAL: AugmentedModule['utils_logging_LOG_LEVEL_FATAL']
/**
   * utils_logging_LOG_LEVEL_ERROR: Error message
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/utils/logger.defines.hpp#L28
   */
  LOG_LEVEL_ERROR: AugmentedModule['utils_logging_LOG_LEVEL_ERROR']
/**
   * Warning message
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/utils/logger.defines.hpp#L29
   */
  LOG_LEVEL_WARNING: AugmentedModule['utils_logging_LOG_LEVEL_WARNING']
/**
   * utils_logging_LOG_LEVEL_INFO: Info message
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/utils/logger.defines.hpp#L30
   */
  LOG_LEVEL_INFO: AugmentedModule['utils_logging_LOG_LEVEL_INFO']
/**
   * Debug message. Disabled in the "Release" build.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/utils/logger.defines.hpp#L31
   */
  LOG_LEVEL_DEBUG: AugmentedModule['utils_logging_LOG_LEVEL_DEBUG']
/**
   * Verbose (trace) messages. Requires verbosity level. Disabled in the "Release" build.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/utils/logger.defines.hpp#L32
   */
  LOG_LEVEL_VERBOSE: AugmentedModule['utils_logging_LOG_LEVEL_VERBOSE']
/**
   * utils logging enum log level force int constant (INT_MAX), defined by OpenCV for cv::utils::logging.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/utils/logger.defines.hpp#L34
   */
  ENUM_LOG_LEVEL_FORCE_INT: AugmentedModule['utils_logging_ENUM_LOG_LEVEL_FORCE_INT']
}
  /** Native utils.nested namespace. */
  nested: CVNamespace<'utils_nested'> & {
/**
   * utils nested original class name value in the OpenCV API.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/bindings_utils.hpp#L281
   */
  OriginalClassName: AugmentedModule['utils_nested_OriginalClassName']
/**
   * utils nested original class name params value in the OpenCV API.
   *
   * @see https://github.com/opencv/opencv/blob/5.0.0/modules/core/include/opencv2/core/bindings_utils.hpp#L284
   */
  OriginalClassName_Params: AugmentedModule['utils_nested_OriginalClassName_Params']
}
}
  /** Native videoio_registry namespace. */
  videoio_registry: CVNamespace<'videoio_registry'> & {

}
  /** Native videostab namespace. */
  videostab: CVNamespace<'videostab'> & {
/**
   * Describes motion model between two point clouds.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/videostab/include/opencv2/videostab/motion_core.hpp#L59
   */
  MotionModel: AugmentedModule['videostab_MotionModel']
/**
   * videostab mm translation constant (0), defined by OpenCV for cv::videostab.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/videostab/include/opencv2/videostab/motion_core.hpp#L61
   */
  MM_TRANSLATION: AugmentedModule['videostab_MM_TRANSLATION']
/**
   * videostab mm translation and scale constant (1), defined by OpenCV for cv::videostab.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/videostab/include/opencv2/videostab/motion_core.hpp#L62
   */
  MM_TRANSLATION_AND_SCALE: AugmentedModule['videostab_MM_TRANSLATION_AND_SCALE']
/**
   * videostab mm rotation constant (2), defined by OpenCV for cv::videostab.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/videostab/include/opencv2/videostab/motion_core.hpp#L63
   */
  MM_ROTATION: AugmentedModule['videostab_MM_ROTATION']
/**
   * videostab mm rigid constant (3), defined by OpenCV for cv::videostab.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/videostab/include/opencv2/videostab/motion_core.hpp#L64
   */
  MM_RIGID: AugmentedModule['videostab_MM_RIGID']
/**
   * videostab mm similarity constant (4), defined by OpenCV for cv::videostab.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/videostab/include/opencv2/videostab/motion_core.hpp#L65
   */
  MM_SIMILARITY: AugmentedModule['videostab_MM_SIMILARITY']
/**
   * videostab mm affine constant (5), defined by OpenCV for cv::videostab.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/videostab/include/opencv2/videostab/motion_core.hpp#L66
   */
  MM_AFFINE: AugmentedModule['videostab_MM_AFFINE']
/**
   * videostab mm homography constant (6), defined by OpenCV for cv::videostab.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/videostab/include/opencv2/videostab/motion_core.hpp#L67
   */
  MM_HOMOGRAPHY: AugmentedModule['videostab_MM_HOMOGRAPHY']
/**
   * videostab mm unknown constant (7), defined by OpenCV for cv::videostab.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/videostab/include/opencv2/videostab/motion_core.hpp#L68
   */
  MM_UNKNOWN: AugmentedModule['videostab_MM_UNKNOWN']
}
  /** Native wechat_qrcode namespace. */
  wechat_qrcode: CVNamespace<'wechat_qrcode'> & {
/**
   * WeChat QRCode includes two CNN-based models:
   * A object detection model and a super resolution model.
   * Object detection model is applied to detect QRCode with the bounding box.
   * super resolution model is applied to zoom in QRCode when it is small.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/wechat_qrcode/include/opencv2/wechat_qrcode.hpp#L24
   */
  WeChatQRCode: AugmentedModule['wechat_qrcode_WeChatQRCode']
}
  /** Native xfeatures2d namespace. */
  xfeatures2d: CVNamespace<'xfeatures2d'> & {
/**
   * Class implementing the FREAK (*Fast Retina Keypoint*) keypoint descriptor, described in [AOV12] .
   *
   * The algorithm propose a novel keypoint descriptor inspired by the human visual system and more
   * precisely the retina, coined Fast Retina Key- point (FREAK). A cascade of binary strings is
   * computed by efficiently comparing image intensities over a retinal sampling pattern. FREAKs are in
   * general faster to compute with lower memory load and also more robust than SIFT, SURF or BRISK.
   * They are competitive alternatives to existing keypoints in particular for embedded applications.
   *
   * **Note:** -   An example on how to use the FREAK descriptor can be found at
   *         opencv_source_code/samples/cpp/freak_demo.cpp
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xfeatures2d/include/opencv2/xfeatures2d.hpp#L88
   */
  FREAK: AugmentedModule['xfeatures2d_FREAK']
/**
   * The class implements the keypoint detector introduced by [Agrawal08], synonym of StarDetector. :
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xfeatures2d/include/opencv2/xfeatures2d.hpp#L127
   */
  StarDetector: AugmentedModule['xfeatures2d_StarDetector']
/**
   * BRIEF Descriptor
   * Class for computing BRIEF descriptors described in [calon2010] .
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xfeatures2d/include/opencv2/xfeatures2d.hpp#L164
   */
  BriefDescriptorExtractor: AugmentedModule['xfeatures2d_BriefDescriptorExtractor']
/**
   * Class implementing the locally uniform comparison image descriptor, described in [LUCID]
   *
   * An image descriptor that can be computed very fast, while being
   * about as robust as, for example, SURF or BRIEF.
   *
   * **Note:** It requires a color image as input.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xfeatures2d/include/opencv2/xfeatures2d.hpp#L185
   */
  LUCID: AugmentedModule['xfeatures2d_LUCID']
/**
   * LATCH Descriptor
   * latch Class for computing the LATCH descriptor.
   * If you find this code useful, please add a reference to the following paper in your work:
   * Gil Levi and Tal Hassner, "LATCH: Learned Arrangements of Three Patch Codes", arXiv preprint arXiv:1501.03719, 15 Jan. 2015
   *
   * LATCH is a binary descriptor based on learned comparisons of triplets of image patches.
   * bytes is the size of the descriptor - can be 64, 32, 16, 8, 4, 2 or 1
   * rotationInvariance - whether or not the descriptor should compansate for orientation changes.
   * half_ssd_size - the size of half of the mini-patches size. For example, if we would like to compare triplets of patches of size 7x7x
   *     then the half_ssd_size should be (7-1)/2 = 3.
   * sigma - sigma value for GaussianBlur smoothing of the source image. Source image will be used without smoothing in case sigma value is 0.
   *
   * Note: the descriptor can be coupled with any keypoint extractor. The only demand is that if you use set rotationInvariance = True then
   *     you will have to use an extractor which estimates the patch orientation (in degrees). Examples for such extractors are ORB and SIFT.
   *
   * Note: a complete example can be found under /samples/cpp/tutorial_code/xfeatures2D/latch_match.cpp
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xfeatures2d/include/opencv2/xfeatures2d.hpp#L226
   */
  LATCH: AugmentedModule['xfeatures2d_LATCH']
/**
   * Class implementing BEBLID (Boosted Efficient Binary Local Image Descriptor),
   * described in [Suarez2020BEBLID] .
   *
   * BEBLID [Suarez2020BEBLID] is a efficient binary descriptor learned with boosting.
   * It is able to describe keypoints from any detector just by changing the scale_factor parameter.
   * In several benchmarks it has proved to largely improve other binary descriptors like ORB or
   * BRISK with the same efficiency. BEBLID describes using the difference of mean gray values in
   * different regions of the image around the KeyPoint, the descriptor is specifically optimized for
   * image matching and patch retrieval addressing the asymmetries of these problems.
   *
   * If you find this code useful, please add a reference to the following paper:
   * <BLOCKQUOTE> Iago Suárez, Ghesn Sfeir, José M. Buenaposada, and Luis Baumela.
   * BEBLID: Boosted efficient binary local image descriptor.
   * Pattern Recognition Letters, 133:366-372, 2020. </BLOCKQUOTE>
   *
   * The descriptor was trained using 1 million of randomly sampled pairs of patches
   * (20% positives and 80% negatives) from the Liberty split of the UBC datasets
   * [winder2007learning] as described in the paper [Suarez2020BEBLID].
   * You can check in the [AKAZE example](https://raw.githubusercontent.com/opencv/opencv/master/samples/cpp/tutorial_code/features2D/AKAZE_match.cpp)
   * how well BEBLID works. Detecting 10000 keypoints with ORB and describing with BEBLID obtains
   * 561 inliers (75%) whereas describing with ORB obtains only 493 inliers (63%).
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xfeatures2d/include/opencv2/xfeatures2d.hpp#L268
   */
  BEBLID: AugmentedModule['xfeatures2d_BEBLID']
/**
   * Class implementing TEBLID (Triplet-based Efficient Binary Local Image Descriptor),
   * described in [Suarez2021TEBLID].
   *
   * TEBLID stands for Triplet-based Efficient Binary Local Image Descriptor, although originally it was called BAD
   * [Suarez2021TEBLID]. It is an improvement over BEBLID [Suarez2020BEBLID], that uses triplet loss,
   * hard negative mining, and anchor swap to improve the image matching results.
   * It is able to describe keypoints from any detector just by changing the scale_factor parameter.
   * TEBLID is as efficient as ORB, BEBLID or BRISK, but the triplet-based training objective selected more
   * discriminative features that explain the accuracy gain. It is also more compact than BEBLID,
   * when running the [AKAZE example](https://github.com/opencv/opencv/blob/5.x/samples/cpp/tutorial_code/features2D/AKAZE_match.cpp)
   * with 10000 keypoints detected by ORB, BEBLID obtains 561 inliers (75%) with 512 bits, whereas
   * TEBLID obtains 621 (75.2%) with 256 bits. ORB obtains only 493 inliers (63%).
   *
   * If you find this code useful, please add a reference to the following paper:
   * <BLOCKQUOTE> Iago Suárez, José M. Buenaposada, and Luis Baumela.
   * Revisiting Binary Local Image Description for Resource Limited Devices.
   * IEEE Robotics and Automation Letters, vol. 6, no. 4, pp. 8317-8324, Oct. 2021. </BLOCKQUOTE>
   *
   * The descriptor was trained in Liberty split of the UBC datasets [winder2007learning] .
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xfeatures2d/include/opencv2/xfeatures2d.hpp#L316
   */
  TEBLID: AugmentedModule['xfeatures2d_TEBLID']
/**
   * Class implementing DAISY descriptor, described in [Tola10]
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xfeatures2d/include/opencv2/xfeatures2d.hpp#L357
   */
  DAISY: AugmentedModule['xfeatures2d_DAISY']
/**
   * Class implementing the MSD (*Maximal Self-Dissimilarity*) keypoint detector, described in [Tombari14].
   *
   * The algorithm implements a novel interest point detector stemming from the intuition that image patches
   * which are highly dissimilar over a relatively large extent of their surroundings hold the property of
   * being repeatable and distinctive. This concept of "contextual self-dissimilarity" reverses the key
   * paradigm of recent successful techniques such as the Local Self-Similarity descriptor and the Non-Local
   * Means filter, which build upon the presence of similar - rather than dissimilar - patches. Moreover,
   * it extends to contextual information the local self-dissimilarity notion embedded in established
   * detectors of corner-like interest points, thereby achieving enhanced repeatability, distinctiveness and
   * localization accuracy.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xfeatures2d/include/opencv2/xfeatures2d.hpp#L467
   */
  MSDDetector: AugmentedModule['xfeatures2d_MSDDetector']
/**
   * Class implementing VGG (Oxford Visual Geometry Group) descriptor trained end to end
   * using "Descriptor Learning Using Convex Optimisation" (DLCO) aparatus described in [Simonyan14].
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xfeatures2d/include/opencv2/xfeatures2d.hpp#L522
   */
  VGG: AugmentedModule['xfeatures2d_VGG']
/**
   * Class implementing BoostDesc (Learning Image Descriptors with Boosting), described in
   * [Trzcinski13a] and [Trzcinski13b].
   *
   * **Note:** BGM is the base descriptor where each binary dimension is computed as the output of a single weak learner.
   * BGM_HARD and BGM_BILINEAR refers to same BGM but use different type of gradient binning. In the BGM_HARD that
   * use ASSIGN_HARD binning type the gradient is assigned to the nearest orientation bin. In the BGM_BILINEAR that use
   * ASSIGN_BILINEAR binning type the gradient is assigned to the two neighbouring bins. In the BGM and all other modes that use
   * ASSIGN_SOFT binning type the gradient is assigned to 8 nearest bins according to the cosine value between the gradient
   * angle and the bin center. LBGM (alias FP-Boost) is the floating point extension where each dimension is computed
   * as a linear combination of the weak learner responses. BINBOOST and subvariants are the binary extensions of LBGM
   * where each bit is computed as a thresholded linear combination of a set of weak learners.
   * BoostDesc header files (boostdesc_*.i) was exported from original binaries with export-boostdesc.py script from
   * samples subfolder.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xfeatures2d/include/opencv2/xfeatures2d.hpp#L580
   */
  BoostDesc: AugmentedModule['xfeatures2d_BoostDesc']
/**
   * Position-Color-Texture signatures
   * Class implementing PCT (position-color-texture) signature extraction
   *       as described in [KrulisLS16].
   *       The algorithm is divided to a feature sampler and a clusterizer.
   *       Feature sampler produces samples at given set of coordinates.
   *       Clusterizer then produces clusters of these samples using k-means algorithm.
   *       Resulting set of clusters is the signature of the input image.
   *
   *       A signature is an array of SIGNATURE_DIMENSION-dimensional points.
   *       Used dimensions are:
   *       weight, x, y position; lab color, contrast, entropy.
   * [KrulisLS16]
   * [BeecksUS10]
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xfeatures2d/include/opencv2/xfeatures2d.hpp#L621
   */
  PCTSignatures: AugmentedModule['xfeatures2d_PCTSignatures']
/**
   * Class implementing Signature Quadratic Form Distance (SQFD).
   * See: Christian Beecks, Merih Seran Uysal, Thomas Seidl.
   *   Signature quadratic form distance.
   *   In Proceedings of the ACM International Conference on Image and Video Retrieval, pages 438-445.
   *   ACM, 2010.
   * [BeecksUS10]
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xfeatures2d/include/opencv2/xfeatures2d.hpp#L1034
   */
  PCTSignaturesSQFD: AugmentedModule['xfeatures2d_PCTSignaturesSQFD']
/**
   * Class implementing the Harris-Laplace feature detector as described in [Mikolajczyk2004].
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xfeatures2d/include/opencv2/xfeatures2d.hpp#L1092
   */
  HarrisLaplaceFeatureDetector: AugmentedModule['xfeatures2d_HarrisLaplaceFeatureDetector']
/**
   * Class implementing affine adaptation for key points.
   *
   * A `FeatureDetector` and a `DescriptorExtractor` are wrapped to augment the
   * detected points with their affine invariant elliptic region and to compute
   * the feature descriptors on the regions after warping them into circles.
   *
   * The interface is equivalent to `Feature2D`, adding operations for
   * `Elliptic_KeyPoint` "Elliptic_KeyPoints" instead of `KeyPoint` "KeyPoints".
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xfeatures2d/include/opencv2/xfeatures2d.hpp#L1139
   */
  AffineFeature2D: AugmentedModule['xfeatures2d_AffineFeature2D']
/**
   * Class implementing the Tree Based Morse Regions (TBMR) as described in
   * [Najman2014] extended with scaled extraction ability.
   *
   * **Note:** This algorithm is based on Component Tree (Min/Max) as well as MSER but
   * uses a Morse-theory approach to extract features.
   *
   * Features are ellipses (similar to MSER, however a MSER feature can never be a
   * TBMR feature and vice versa).
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xfeatures2d/include/opencv2/xfeatures2d.hpp#L1200
   */
  TBMR: AugmentedModule['xfeatures2d_TBMR']
/**
   * Class implementing the BRISK keypoint detector and descriptor extractor, described in [LCS11] .
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xfeatures2d/include/opencv2/xfeatures2d.hpp#L1222
   */
  BRISK: AugmentedModule['xfeatures2d_BRISK']
/**
   * Wrapping class for feature detection using the AGAST method. :
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xfeatures2d/include/opencv2/xfeatures2d.hpp#L1287
   */
  AgastFeatureDetector: AugmentedModule['xfeatures2d_AgastFeatureDetector']
/**
   * Class implementing the KAZE keypoint detector and descriptor extractor, described in [ABD12] .
   *
   * **Note:** AKAZE descriptor can only be used with KAZE or AKAZE keypoints .. [ABD12] KAZE Features. Pablo
   * F. Alcantarilla, Adrien Bartoli and Andrew J. Davison. In European Conference on Computer Vision
   * (ECCV), Fiorenze, Italy, October 2012.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xfeatures2d/include/opencv2/xfeatures2d.hpp#L1342
   */
  KAZE: AugmentedModule['xfeatures2d_KAZE']
/**
   * Class implementing the AKAZE keypoint detector and descriptor extractor, described in [ANB13].
   *
   * AKAZE descriptors can only be used with KAZE or AKAZE keypoints. This class is thread-safe.
   *
   * **Note:** When you need descriptors use Feature2D::detectAndCompute, which
   * provides better performance. When using Feature2D::detect followed by
   * Feature2D::compute scale space pyramid is computed twice.
   *
   * **Note:** AKAZE implements T-API. When image is passed as UMat some parts of the algorithm
   * will use OpenCL.
   *
   * **Note:** [ANB13] Fast Explicit Diffusion for Accelerated Features in Nonlinear
   * Scale Spaces. Pablo F. Alcantarilla, Jesús Nuevo and Adrien Bartoli. In
   * British Machine Vision Conference (BMVC), Bristol, UK, September 2013.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xfeatures2d/include/opencv2/xfeatures2d.hpp#L1405
   */
  AKAZE: AugmentedModule['xfeatures2d_AKAZE']
/**
   * \
   *                                     Bag of visual words                                *
   * \***************************************************************************************
   *
   * Abstract base class for training the *bag of visual words* vocabulary from a set of descriptors.
   *
   * For details, see, for example, *Visual Categorization with Bags of Keypoints* by Gabriella Csurka,
   * Christopher R. Dance, Lixin Fan, Jutta Willamowski, Cedric Bray, 2004. :
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xfeatures2d/include/opencv2/xfeatures2d.hpp#L1538
   */
  BOWTrainer: AugmentedModule['xfeatures2d_BOWTrainer']
/**
   * kmeans -based class to train visual vocabulary using the *bag of visual words* approach. :
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xfeatures2d/include/opencv2/xfeatures2d.hpp#L1584
   */
  BOWKMeansTrainer: AugmentedModule['xfeatures2d_BOWKMeansTrainer']
/**
   * Class to compute an image descriptor using the *bag of visual words*.
   *
   * Such a computation consists of the following steps:
   *
   * 1.  Compute descriptors for a given image and its keypoints set.
   * 2.  Find the nearest visual words from the vocabulary for each keypoint descriptor.
   * 3.  Compute the bag-of-words image descriptor as is a normalized histogram of vocabulary words
   * encountered in the image. The i-th bin of the histogram is a frequency of i-th word of the
   * vocabulary in the given image.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xfeatures2d/include/opencv2/xfeatures2d.hpp#L1617
   */
  BOWImgDescriptorExtractor: AugmentedModule['xfeatures2d_BOWImgDescriptorExtractor']
/**
   * Class for extracting Speeded Up Robust Features from an image [Bay06] .
   *
   * The algorithm parameters:
   * -   member int extended
   *     -   0 means that the basic descriptors (64 elements each) shall be computed
   *     -   1 means that the extended descriptors (128 elements each) shall be computed
   * -   member int upright
   *     -   0 means that detector computes orientation of each feature.
   *     -   1 means that the orientation is not computed (which is much, much faster). For example,
   * if you match images from a stereo pair, or do image stitching, the matched features
   * likely have very similar angles, and you can speed up feature extraction by setting
   * upright=1.
   * -   member double hessianThreshold
   * Threshold for the keypoint detector. Only features, whose hessian is larger than
   * hessianThreshold are retained by the detector. Therefore, the larger the value, the less
   * keypoints you will get. A good default value could be from 300 to 500, depending from the
   * image contrast.
   * -   member int nOctaves
   * The number of a gaussian pyramid octaves that the detector uses. It is set to 4 by default.
   * If you want to get very large features, use the larger value. If you want just small
   * features, decrease it.
   * -   member int nOctaveLayers
   * The number of images within each octave of a gaussian pyramid. It is set to 2 by default.
   *
   * **Note:** -   An example using the SURF feature detector can be found at
   *         opencv_source_code/samples/cpp/generic_descriptor_match.cpp
   *     -   Another example using the SURF feature detector, extractor and matcher can be found at
   *         opencv_source_code/samples/cpp/matcher_simple.cpp
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xfeatures2d/include/opencv2/xfeatures2d/nonfree.hpp#L85
   */
  SURF: AugmentedModule['xfeatures2d_SURF']
/**
   * Descriptor number of bits, each bit is a boosting weak-learner.
   * The user can choose between 512 or 256 bits.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xfeatures2d/include/opencv2/xfeatures2d.hpp#L275
   */
  BEBLID_BeblidSize: AugmentedModule['xfeatures2d_BEBLID_BeblidSize']
/**
   * Descriptor number of bits, each bit is a box average difference.
   * The user can choose between 256 or 512 bits.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xfeatures2d/include/opencv2/xfeatures2d.hpp#L323
   */
  TEBLID_TeblidSize: AugmentedModule['xfeatures2d_TEBLID_TeblidSize']
/**
   * Native enum entries for xfeatures2d daisy normalization type. Pass an entry to enum-typed arguments or its .value to numeric arguments.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xfeatures2d/include/opencv2/xfeatures2d.hpp#L360
   */
  DAISY_NormalizationType: AugmentedModule['xfeatures2d_DAISY_NormalizationType']
/**
   * Lp distance function selector.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xfeatures2d/include/opencv2/xfeatures2d.hpp#L627
   */
  PCTSignatures_DistanceFunction: AugmentedModule['xfeatures2d_PCTSignatures_DistanceFunction']
/**
   * Point distributions supported by random point generator.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xfeatures2d/include/opencv2/xfeatures2d.hpp#L635
   */
  PCTSignatures_PointDistribution: AugmentedModule['xfeatures2d_PCTSignatures_PointDistribution']
/**
   * Similarity function selector.
   * See: Christian Beecks, Merih Seran Uysal, Thomas Seidl.
   *       Signature quadratic form distance.
   *       In Proceedings of the ACM International Conference on Image and Video Retrieval, pages 438-445.
   *       ACM, 2010.
   * [BeecksUS10]
   *
   * **Note:** For selected distance function: 
   * ```math
   *  d(c_i, c_j) 
   * ```
   *   and parameter: 
   * ```math
   *  \alpha 
   * ```
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xfeatures2d/include/opencv2/xfeatures2d.hpp#L652
   */
  PCTSignatures_SimilarityFunction: AugmentedModule['xfeatures2d_PCTSignatures_SimilarityFunction']
/**
   * xfeatures2d beblid size 512 bits constant (100), defined by OpenCV for cv::xfeatures2d::BEBLID.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xfeatures2d/include/opencv2/xfeatures2d.hpp#L277
   */
  BEBLID_SIZE_512_BITS: AugmentedModule['xfeatures2d_BEBLID_SIZE_512_BITS']
/**
   * xfeatures2d beblid size 256 bits constant (101), defined by OpenCV for cv::xfeatures2d::BEBLID.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xfeatures2d/include/opencv2/xfeatures2d.hpp#L277
   */
  BEBLID_SIZE_256_BITS: AugmentedModule['xfeatures2d_BEBLID_SIZE_256_BITS']
/**
   * xfeatures2d teblid size 256 bits constant (102), defined by OpenCV for cv::xfeatures2d::TEBLID.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xfeatures2d/include/opencv2/xfeatures2d.hpp#L325
   */
  TEBLID_SIZE_256_BITS: AugmentedModule['xfeatures2d_TEBLID_SIZE_256_BITS']
/**
   * xfeatures2d teblid size 512 bits constant (103), defined by OpenCV for cv::xfeatures2d::TEBLID.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xfeatures2d/include/opencv2/xfeatures2d.hpp#L325
   */
  TEBLID_SIZE_512_BITS: AugmentedModule['xfeatures2d_TEBLID_SIZE_512_BITS']
/**
   * xfeatures2d daisy nrm none constant (100), defined by OpenCV for cv::xfeatures2d::DAISY.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xfeatures2d/include/opencv2/xfeatures2d.hpp#L362
   */
  DAISY_NRM_NONE: AugmentedModule['xfeatures2d_DAISY_NRM_NONE']
/**
   * xfeatures2d daisy nrm partial constant (101), defined by OpenCV for cv::xfeatures2d::DAISY.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xfeatures2d/include/opencv2/xfeatures2d.hpp#L362
   */
  DAISY_NRM_PARTIAL: AugmentedModule['xfeatures2d_DAISY_NRM_PARTIAL']
/**
   * xfeatures2d daisy nrm full constant (102), defined by OpenCV for cv::xfeatures2d::DAISY.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xfeatures2d/include/opencv2/xfeatures2d.hpp#L362
   */
  DAISY_NRM_FULL: AugmentedModule['xfeatures2d_DAISY_NRM_FULL']
/**
   * xfeatures2d daisy nrm sift constant (103), defined by OpenCV for cv::xfeatures2d::DAISY.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xfeatures2d/include/opencv2/xfeatures2d.hpp#L362
   */
  DAISY_NRM_SIFT: AugmentedModule['xfeatures2d_DAISY_NRM_SIFT']
/**
   * xfeatures2d pctsignatures l0 25 constant (0), defined by OpenCV for cv::xfeatures2d::PCTSignatures.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xfeatures2d/include/opencv2/xfeatures2d.hpp#L629
   */
  PCTSignatures_L0_25: AugmentedModule['xfeatures2d_PCTSignatures_L0_25']
/**
   * xfeatures2d pctsignatures l0 25 constant (0), defined by OpenCV for cv::xfeatures2d::PCTSignatures.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xfeatures2d/include/opencv2/xfeatures2d.hpp#L629
   */
  PCTSIGNATURES_L0_25: AugmentedModule['xfeatures2d_PCTSIGNATURES_L0_25']
/**
   * xfeatures2d pctsignatures l0 5 constant (1), defined by OpenCV for cv::xfeatures2d::PCTSignatures.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xfeatures2d/include/opencv2/xfeatures2d.hpp#L629
   */
  PCTSignatures_L0_5: AugmentedModule['xfeatures2d_PCTSignatures_L0_5']
/**
   * xfeatures2d pctsignatures l0 5 constant (1), defined by OpenCV for cv::xfeatures2d::PCTSignatures.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xfeatures2d/include/opencv2/xfeatures2d.hpp#L629
   */
  PCTSIGNATURES_L0_5: AugmentedModule['xfeatures2d_PCTSIGNATURES_L0_5']
/**
   * xfeatures2d pctsignatures l1 constant (2), defined by OpenCV for cv::xfeatures2d::PCTSignatures.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xfeatures2d/include/opencv2/xfeatures2d.hpp#L629
   */
  PCTSignatures_L1: AugmentedModule['xfeatures2d_PCTSignatures_L1']
/**
   * xfeatures2d pctsignatures l1 constant (2), defined by OpenCV for cv::xfeatures2d::PCTSignatures.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xfeatures2d/include/opencv2/xfeatures2d.hpp#L629
   */
  PCTSIGNATURES_L1: AugmentedModule['xfeatures2d_PCTSIGNATURES_L1']
/**
   * xfeatures2d pctsignatures l2 constant (3), defined by OpenCV for cv::xfeatures2d::PCTSignatures.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xfeatures2d/include/opencv2/xfeatures2d.hpp#L629
   */
  PCTSignatures_L2: AugmentedModule['xfeatures2d_PCTSignatures_L2']
/**
   * xfeatures2d pctsignatures l2 constant (3), defined by OpenCV for cv::xfeatures2d::PCTSignatures.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xfeatures2d/include/opencv2/xfeatures2d.hpp#L629
   */
  PCTSIGNATURES_L2: AugmentedModule['xfeatures2d_PCTSIGNATURES_L2']
/**
   * xfeatures2d pctsignatures l2 squared constant (4), defined by OpenCV for cv::xfeatures2d::PCTSignatures.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xfeatures2d/include/opencv2/xfeatures2d.hpp#L629
   */
  PCTSignatures_L2SQUARED: AugmentedModule['xfeatures2d_PCTSignatures_L2SQUARED']
/**
   * xfeatures2d pctsignatures l2 squared constant (4), defined by OpenCV for cv::xfeatures2d::PCTSignatures.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xfeatures2d/include/opencv2/xfeatures2d.hpp#L629
   */
  PCTSIGNATURES_L2SQUARED: AugmentedModule['xfeatures2d_PCTSIGNATURES_L2SQUARED']
/**
   * xfeatures2d pctsignatures l5 constant (5), defined by OpenCV for cv::xfeatures2d::PCTSignatures.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xfeatures2d/include/opencv2/xfeatures2d.hpp#L629
   */
  PCTSignatures_L5: AugmentedModule['xfeatures2d_PCTSignatures_L5']
/**
   * xfeatures2d pctsignatures l5 constant (5), defined by OpenCV for cv::xfeatures2d::PCTSignatures.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xfeatures2d/include/opencv2/xfeatures2d.hpp#L629
   */
  PCTSIGNATURES_L5: AugmentedModule['xfeatures2d_PCTSIGNATURES_L5']
/**
   * xfeatures2d pctsignatures l infinity constant (6), defined by OpenCV for cv::xfeatures2d::PCTSignatures.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xfeatures2d/include/opencv2/xfeatures2d.hpp#L629
   */
  PCTSignatures_L_INFINITY: AugmentedModule['xfeatures2d_PCTSignatures_L_INFINITY']
/**
   * xfeatures2d pctsignatures l infinity constant (6), defined by OpenCV for cv::xfeatures2d::PCTSignatures.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xfeatures2d/include/opencv2/xfeatures2d.hpp#L629
   */
  PCTSIGNATURES_L_INFINITY: AugmentedModule['xfeatures2d_PCTSIGNATURES_L_INFINITY']
/**
   * Generate numbers uniformly.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xfeatures2d/include/opencv2/xfeatures2d.hpp#L637
   */
  PCTSignatures_UNIFORM: AugmentedModule['xfeatures2d_PCTSignatures_UNIFORM']
/**
   * Generate numbers uniformly.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xfeatures2d/include/opencv2/xfeatures2d.hpp#L637
   */
  PCTSIGNATURES_UNIFORM: AugmentedModule['xfeatures2d_PCTSIGNATURES_UNIFORM']
/**
   * Generate points in a regular grid.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xfeatures2d/include/opencv2/xfeatures2d.hpp#L638
   */
  PCTSignatures_REGULAR: AugmentedModule['xfeatures2d_PCTSignatures_REGULAR']
/**
   * Generate points in a regular grid.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xfeatures2d/include/opencv2/xfeatures2d.hpp#L638
   */
  PCTSIGNATURES_REGULAR: AugmentedModule['xfeatures2d_PCTSIGNATURES_REGULAR']
/**
   * Generate points with normal (gaussian) distribution.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xfeatures2d/include/opencv2/xfeatures2d.hpp#L639
   */
  PCTSignatures_NORMAL: AugmentedModule['xfeatures2d_PCTSignatures_NORMAL']
/**
   * Generate points with normal (gaussian) distribution.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xfeatures2d/include/opencv2/xfeatures2d.hpp#L639
   */
  PCTSIGNATURES_NORMAL: AugmentedModule['xfeatures2d_PCTSIGNATURES_NORMAL']
/**
   * ```math
   *  -d(c_i, c_j) 
   * ```
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xfeatures2d/include/opencv2/xfeatures2d.hpp#L654
   */
  PCTSignatures_MINUS: AugmentedModule['xfeatures2d_PCTSignatures_MINUS']
/**
   * ```math
   *  -d(c_i, c_j) 
   * ```
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xfeatures2d/include/opencv2/xfeatures2d.hpp#L654
   */
  PCTSIGNATURES_MINUS: AugmentedModule['xfeatures2d_PCTSIGNATURES_MINUS']
/**
   * ```math
   *  e^{ -\alpha * d^2(c_i, c_j)} 
   * ```
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xfeatures2d/include/opencv2/xfeatures2d.hpp#L655
   */
  PCTSignatures_GAUSSIAN: AugmentedModule['xfeatures2d_PCTSignatures_GAUSSIAN']
/**
   * ```math
   *  e^{ -\alpha * d^2(c_i, c_j)} 
   * ```
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xfeatures2d/include/opencv2/xfeatures2d.hpp#L655
   */
  PCTSIGNATURES_GAUSSIAN: AugmentedModule['xfeatures2d_PCTSIGNATURES_GAUSSIAN']
/**
   * ```math
   *  \frac{1}{\alpha + d(c_i, c_j)} 
   * ```
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xfeatures2d/include/opencv2/xfeatures2d.hpp#L656
   */
  PCTSignatures_HEURISTIC: AugmentedModule['xfeatures2d_PCTSignatures_HEURISTIC']
/**
   * ```math
   *  \frac{1}{\alpha + d(c_i, c_j)} 
   * ```
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xfeatures2d/include/opencv2/xfeatures2d.hpp#L656
   */
  PCTSIGNATURES_HEURISTIC: AugmentedModule['xfeatures2d_PCTSIGNATURES_HEURISTIC']
/**
   * xfeatures2d agast feature detector agast 5 8 constant (0), defined by OpenCV for cv::xfeatures2d::AgastFeatureDetector.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xfeatures2d/include/opencv2/xfeatures2d.hpp#L1292
   */
  AgastFeatureDetector_AGAST_5_8: AugmentedModule['xfeatures2d_AgastFeatureDetector_AGAST_5_8']
/**
   * xfeatures2d agast feature detector agast 5 8 constant (0), defined by OpenCV for cv::xfeatures2d::AgastFeatureDetector.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xfeatures2d/include/opencv2/xfeatures2d.hpp#L1292
   */
  AGAST_FEATURE_DETECTOR_AGAST_5_8: AugmentedModule['xfeatures2d_AGAST_FEATURE_DETECTOR_AGAST_5_8']
/**
   * xfeatures2d agast feature detector agast 7 12d constant (1), defined by OpenCV for cv::xfeatures2d::AgastFeatureDetector.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xfeatures2d/include/opencv2/xfeatures2d.hpp#L1292
   */
  AgastFeatureDetector_AGAST_7_12d: AugmentedModule['xfeatures2d_AgastFeatureDetector_AGAST_7_12d']
/**
   * xfeatures2d agast feature detector agast 7 12 d constant (1), defined by OpenCV for cv::xfeatures2d::AgastFeatureDetector.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xfeatures2d/include/opencv2/xfeatures2d.hpp#L1292
   */
  AGAST_FEATURE_DETECTOR_AGAST_7_12D: AugmentedModule['xfeatures2d_AGAST_FEATURE_DETECTOR_AGAST_7_12D']
/**
   * xfeatures2d agast feature detector agast 7 12s constant (2), defined by OpenCV for cv::xfeatures2d::AgastFeatureDetector.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xfeatures2d/include/opencv2/xfeatures2d.hpp#L1292
   */
  AgastFeatureDetector_AGAST_7_12s: AugmentedModule['xfeatures2d_AgastFeatureDetector_AGAST_7_12s']
/**
   * xfeatures2d agast feature detector agast 7 12 s constant (2), defined by OpenCV for cv::xfeatures2d::AgastFeatureDetector.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xfeatures2d/include/opencv2/xfeatures2d.hpp#L1292
   */
  AGAST_FEATURE_DETECTOR_AGAST_7_12S: AugmentedModule['xfeatures2d_AGAST_FEATURE_DETECTOR_AGAST_7_12S']
/**
   * xfeatures2d agast feature detector oast 9 16 constant (3), defined by OpenCV for cv::xfeatures2d::AgastFeatureDetector.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xfeatures2d/include/opencv2/xfeatures2d.hpp#L1292
   */
  AgastFeatureDetector_OAST_9_16: AugmentedModule['xfeatures2d_AgastFeatureDetector_OAST_9_16']
/**
   * xfeatures2d agast feature detector oast 9 16 constant (3), defined by OpenCV for cv::xfeatures2d::AgastFeatureDetector.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xfeatures2d/include/opencv2/xfeatures2d.hpp#L1292
   */
  AGAST_FEATURE_DETECTOR_OAST_9_16: AugmentedModule['xfeatures2d_AGAST_FEATURE_DETECTOR_OAST_9_16']
/**
   * xfeatures2d agast feature detector threshold constant (10000), defined by OpenCV for cv::xfeatures2d::AgastFeatureDetector.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xfeatures2d/include/opencv2/xfeatures2d.hpp#L1298
   */
  AgastFeatureDetector_THRESHOLD: AugmentedModule['xfeatures2d_AgastFeatureDetector_THRESHOLD']
/**
   * xfeatures2d agast feature detector threshold constant (10000), defined by OpenCV for cv::xfeatures2d::AgastFeatureDetector.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xfeatures2d/include/opencv2/xfeatures2d.hpp#L1298
   */
  AGAST_FEATURE_DETECTOR_THRESHOLD: AugmentedModule['xfeatures2d_AGAST_FEATURE_DETECTOR_THRESHOLD']
/**
   * xfeatures2d agast feature detector nonmax suppression constant (10001), defined by OpenCV for cv::xfeatures2d::AgastFeatureDetector.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xfeatures2d/include/opencv2/xfeatures2d.hpp#L1298
   */
  AgastFeatureDetector_NONMAX_SUPPRESSION: AugmentedModule['xfeatures2d_AgastFeatureDetector_NONMAX_SUPPRESSION']
/**
   * xfeatures2d agast feature detector nonmax suppression constant (10001), defined by OpenCV for cv::xfeatures2d::AgastFeatureDetector.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xfeatures2d/include/opencv2/xfeatures2d.hpp#L1298
   */
  AGAST_FEATURE_DETECTOR_NONMAX_SUPPRESSION: AugmentedModule['xfeatures2d_AGAST_FEATURE_DETECTOR_NONMAX_SUPPRESSION']
/**
   * xfeatures2d kaze diff pm g1 constant (0), defined by OpenCV for cv::xfeatures2d::KAZE.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xfeatures2d/include/opencv2/xfeatures2d.hpp#L1347
   */
  KAZE_DIFF_PM_G1: AugmentedModule['xfeatures2d_KAZE_DIFF_PM_G1']
/**
   * xfeatures2d kaze diff pm g2 constant (1), defined by OpenCV for cv::xfeatures2d::KAZE.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xfeatures2d/include/opencv2/xfeatures2d.hpp#L1348
   */
  KAZE_DIFF_PM_G2: AugmentedModule['xfeatures2d_KAZE_DIFF_PM_G2']
/**
   * xfeatures2d kaze diff weickert constant (2), defined by OpenCV for cv::xfeatures2d::KAZE.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xfeatures2d/include/opencv2/xfeatures2d.hpp#L1349
   */
  KAZE_DIFF_WEICKERT: AugmentedModule['xfeatures2d_KAZE_DIFF_WEICKERT']
/**
   * xfeatures2d kaze diff charbonnier constant (3), defined by OpenCV for cv::xfeatures2d::KAZE.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xfeatures2d/include/opencv2/xfeatures2d.hpp#L1350
   */
  KAZE_DIFF_CHARBONNIER: AugmentedModule['xfeatures2d_KAZE_DIFF_CHARBONNIER']
/**
   * Upright descriptors, not invariant to rotation
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xfeatures2d/include/opencv2/xfeatures2d.hpp#L1411
   */
  AKAZE_DESCRIPTOR_KAZE_UPRIGHT: AugmentedModule['xfeatures2d_AKAZE_DESCRIPTOR_KAZE_UPRIGHT']
/**
   * Upright descriptors, not invariant to rotation
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xfeatures2d/include/opencv2/xfeatures2d.hpp#L1412
   */
  AKAZE_DESCRIPTOR_KAZE: AugmentedModule['xfeatures2d_AKAZE_DESCRIPTOR_KAZE']
/**
   * Upright descriptors, not invariant to rotation
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xfeatures2d/include/opencv2/xfeatures2d.hpp#L1413
   */
  AKAZE_DESCRIPTOR_MLDB_UPRIGHT: AugmentedModule['xfeatures2d_AKAZE_DESCRIPTOR_MLDB_UPRIGHT']
/**
   * Upright descriptors, not invariant to rotation
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xfeatures2d/include/opencv2/xfeatures2d.hpp#L1414
   */
  AKAZE_DESCRIPTOR_MLDB: AugmentedModule['xfeatures2d_AKAZE_DESCRIPTOR_MLDB']
}
  /** Native ximgproc namespace. */
  ximgproc: CVNamespace<'ximgproc'> & {
/**
   * Main interface for all disparity map filters.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ximgproc/include/opencv2/ximgproc/disparity_filter.hpp#L52
   */
  DisparityFilter: AugmentedModule['ximgproc_DisparityFilter']
/**
   * Disparity map filter based on Weighted Least Squares filter (in form of Fast Global Smoother that
   * is a lot faster than traditional Weighted Least Squares filter implementations) and optional use of
   * left-right-consistency-based confidence to refine the results in half-occlusions and uniform areas.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ximgproc/include/opencv2/ximgproc/disparity_filter.hpp#L86
   */
  DisparityWLSFilter: AugmentedModule['ximgproc_DisparityWLSFilter']
/**
   * Class implementing the ED (EdgeDrawing) [topal2012edge], EDLines [akinlar2011edlines], EDPF [akinlar2012edpf], EDCircles [akinlar2013edcircles] and ColorED [akinlar201782] algorithms.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ximgproc/include/opencv2/ximgproc/edge_drawing.hpp#L21
   */
  EdgeDrawing: AugmentedModule['ximgproc_EdgeDrawing']
/**
   * ximgproc edge drawing params value in the OpenCV API.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ximgproc/include/opencv2/ximgproc/edge_drawing.hpp#L33
   */
  EdgeDrawing_Params: AugmentedModule['ximgproc_EdgeDrawing_Params']
/**
   * Interface for realizations of Domain Transform filter.
   *
   * For more details about this filter see [Gastal11] .
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ximgproc/include/opencv2/ximgproc/edge_filter.hpp#L66
   */
  DTFilter: AugmentedModule['ximgproc_DTFilter']
/**
   * Interface for realizations of (Fast) Guided Filter.
   *
   * For more details about this filter see [Kaiming10] [Kaiming15] .
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ximgproc/include/opencv2/ximgproc/edge_filter.hpp#L130
   */
  GuidedFilter: AugmentedModule['ximgproc_GuidedFilter']
/**
   * Interface for Adaptive Manifold Filter realizations.
   *
   * For more details about this filter see [Gastal12] and References_.
   *
   * Below listed optional parameters which may be set up with Algorithm::set function.
   * -   member double sigma_s = 16.0
   * Spatial standard deviation.
   * -   member double sigma_r = 0.2
   * Color space standard deviation.
   * -   member int tree_height = -1
   * Height of the manifold tree (default = -1 : automatically computed).
   * -   member int num_pca_iterations = 1
   * Number of iterations to computed the eigenvector.
   * -   member bool adjust_outliers = false
   * Specify adjust outliers using Eq. 9 or not.
   * -   member bool use_RNG = true
   * Specify use random number generator to compute eigenvector or not.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ximgproc/include/opencv2/ximgproc/edge_filter.hpp#L209
   */
  AdaptiveManifoldFilter: AugmentedModule['ximgproc_AdaptiveManifoldFilter']
/**
   * Interface for implementations of Fast Bilateral Solver.
   *
   * For more details about this solver see [BarronPoole2016] .
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ximgproc/include/opencv2/ximgproc/edge_filter.hpp#L388
   */
  FastBilateralSolverFilter: AugmentedModule['ximgproc_FastBilateralSolverFilter']
/**
   * Interface for implementations of Fast Global Smoother filter.
   *
   * For more details about this filter see [Min2014] and [Farbman2008] .
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ximgproc/include/opencv2/ximgproc/edge_filter.hpp#L463
   */
  FastGlobalSmootherFilter: AugmentedModule['ximgproc_FastGlobalSmootherFilter']
/**
   * Class implementing EdgeBoxes algorithm from [ZitnickECCV14edgeBoxes] :
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ximgproc/include/opencv2/ximgproc/edgeboxes.hpp#L67
   */
  EdgeBoxes: AugmentedModule['ximgproc_EdgeBoxes']
/**
   * Class implementing the FLD (Fast Line Detector) algorithm described
   * in [Lee14] .
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ximgproc/include/opencv2/ximgproc/fast_line_detector.hpp#L24
   */
  FastLineDetector: AugmentedModule['ximgproc_FastLineDetector']
/**
   * Class for ContourFitting algorithms.
   *     ContourFitting match two contours ` z_a ` and ` z_b ` minimizing distance
   *     
   * ```math
   *  d(z_a,z_b)=\sum (a_n - s  b_n e^{j(n \alpha +\phi )})^2 
   * ```
   *  where ` a_n ` and ` b_n ` are Fourier descriptors of ` z_a ` and ` z_b ` and s is a scaling factor and  ` \phi ` is angle rotation and ` \alpha ` is starting point factor adjustement
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ximgproc/include/opencv2/ximgproc/fourier_descriptors.hpp#L20
   */
  ContourFitting: AugmentedModule['ximgproc_ContourFitting']
/**
   * Class implementing the LSC (Linear Spectral Clustering) superpixels
   * algorithm described in [LiCVPR2015LSC].
   *
   * LSC (Linear Spectral Clustering) produces compact and uniform superpixels with low
   * computational costs. Basically, a normalized cuts formulation of the superpixel
   * segmentation is adopted based on a similarity metric that measures the color
   * similarity and space proximity between image pixels. LSC is of linear computational
   * complexity and high memory efficiency and is able to preserve global properties of images
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ximgproc/include/opencv2/ximgproc/lsc.hpp#L71
   */
  SuperpixelLSC: AugmentedModule['ximgproc_SuperpixelLSC']
/**
   * Applies Ridge Detection Filter to an input image.
   * Implements Ridge detection similar to the one in [Mathematica](http://reference.wolfram.com/language/ref/RidgeFilter.html)
   * using the eigen values from the Hessian Matrix of the input image using Sobel Derivatives.
   * Additional refinement can be done using Skeletonization and Binarization. Adapted from [segleafvein] and [M_RF]
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ximgproc/include/opencv2/ximgproc/ridgefilter.hpp#L27
   */
  RidgeDetectionFilter: AugmentedModule['ximgproc_RidgeDetectionFilter']
/**
   * Class implementing the F-DBSCAN (Accelerated superpixel image segmentation with a parallelized DBSCAN algorithm) superpixels
   * algorithm by Loke SC, et al. [loke2021accelerated] for original paper.
   *
   * The algorithm uses a parallelised DBSCAN cluster search that is resistant to noise, competitive in segmentation quality, and faster than
   * existing superpixel segmentation methods. When tested on the Berkeley Segmentation Dataset, the average processing speed is 175 frames/s
   * with a Boundary Recall of 0.797 and an Achievable Segmentation Accuracy of 0.944. The computational complexity is quadratic O(n2) and
   * more suited to smaller images, but can still process a 2MP colour image faster than the SEEDS algorithm in OpenCV. The output is deterministic
   * when the number of processing threads is fixed, and requires the source image to be in Lab colour format.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ximgproc/include/opencv2/ximgproc/scansegment.hpp#L23
   */
  ScanSegment: AugmentedModule['ximgproc_ScanSegment']
/**
   * Class implementing the SEEDS (Superpixels Extracted via Energy-Driven Sampling) superpixels
   * algorithm described in [VBRV14] .
   *
   * The algorithm uses an efficient hill-climbing algorithm to optimize the superpixels' energy
   * function that is based on color histograms and a boundary term, which is optional. The energy
   * function encourages superpixels to be of the same color, and if the boundary term is activated, the
   * superpixels have smooth boundaries and are of similar shape. In practice it starts from a regular
   * grid of superpixels and moves the pixels or blocks of pixels at the boundaries to refine the
   * solution. The algorithm runs in real-time using a single CPU.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ximgproc/include/opencv2/ximgproc/seeds.hpp#L66
   */
  SuperpixelSEEDS: AugmentedModule['ximgproc_SuperpixelSEEDS']
/**
   * Graph Based Segmentation Algorithm.
   *                         The class implements the algorithm described in [PFF2004] .
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ximgproc/include/opencv2/ximgproc/segmentation.hpp#L46
   */
  segmentation_GraphSegmentation: AugmentedModule['ximgproc_segmentation_GraphSegmentation']
/**
   * Strategie for the selective search segmentation algorithm
   *                         The class implements a generic stragery for the algorithm described in [uijlings2013selective].
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ximgproc/include/opencv2/ximgproc/segmentation.hpp#L74
   */
  segmentation_SelectiveSearchSegmentationStrategy: AugmentedModule['ximgproc_segmentation_SelectiveSearchSegmentationStrategy']
/**
   * Color-based strategy for the selective search segmentation algorithm
   *                         The class is implemented from the algorithm described in [uijlings2013selective].
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ximgproc/include/opencv2/ximgproc/segmentation.hpp#L100
   */
  segmentation_SelectiveSearchSegmentationStrategyColor: AugmentedModule['ximgproc_segmentation_SelectiveSearchSegmentationStrategyColor']
/**
   * Size-based strategy for the selective search segmentation algorithm
   *                         The class is implemented from the algorithm described in [uijlings2013selective].
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ximgproc/include/opencv2/ximgproc/segmentation.hpp#L109
   */
  segmentation_SelectiveSearchSegmentationStrategySize: AugmentedModule['ximgproc_segmentation_SelectiveSearchSegmentationStrategySize']
/**
   * Texture-based strategy for the selective search segmentation algorithm
   *                         The class is implemented from the algorithm described in [uijlings2013selective].
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ximgproc/include/opencv2/ximgproc/segmentation.hpp#L118
   */
  segmentation_SelectiveSearchSegmentationStrategyTexture: AugmentedModule['ximgproc_segmentation_SelectiveSearchSegmentationStrategyTexture']
/**
   * Fill-based strategy for the selective search segmentation algorithm
   *                         The class is implemented from the algorithm described in [uijlings2013selective].
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ximgproc/include/opencv2/ximgproc/segmentation.hpp#L127
   */
  segmentation_SelectiveSearchSegmentationStrategyFill: AugmentedModule['ximgproc_segmentation_SelectiveSearchSegmentationStrategyFill']
/**
   * Regroup multiple strategies for the selective search segmentation algorithm
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ximgproc/include/opencv2/ximgproc/segmentation.hpp#L135
   */
  segmentation_SelectiveSearchSegmentationStrategyMultiple: AugmentedModule['ximgproc_segmentation_SelectiveSearchSegmentationStrategyMultiple']
/**
   * Selective search segmentation algorithm
   *                         The class implements the algorithm described in [uijlings2013selective].
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ximgproc/include/opencv2/ximgproc/segmentation.hpp#L181
   */
  segmentation_SelectiveSearchSegmentation: AugmentedModule['ximgproc_segmentation_SelectiveSearchSegmentation']
/**
   * Class implementing the SLIC (Simple Linear Iterative Clustering) superpixels
   * algorithm described in [Achanta2012].
   *
   * SLIC (Simple Linear Iterative Clustering) clusters pixels using pixel channels and image plane space
   * to efficiently generate compact, nearly uniform superpixels. The simplicity of approach makes it
   * extremely easy to use a lone parameter specifies the number of superpixels and the efficiency of
   * the algorithm makes it very practical.
   * Several optimizations are available for SLIC class:
   * SLICO stands for "Zero parameter SLIC" and it is an optimization of baseline SLIC described in [Achanta2012].
   * MSLIC stands for "Manifold SLIC" and it is an optimization of baseline SLIC described in [Liu_2017_IEEE].
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ximgproc/include/opencv2/ximgproc/slic.hpp#L78
   */
  SuperpixelSLIC: AugmentedModule['ximgproc_SuperpixelSLIC']
/**
   * Main interface for all filters, that take sparse matches as an
   * input and produce a dense per-pixel matching (optical flow) as an output.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ximgproc/include/opencv2/ximgproc/sparse_match_interpolator.hpp#L52
   */
  SparseMatchInterpolator: AugmentedModule['ximgproc_SparseMatchInterpolator']
/**
   * Sparse match interpolation algorithm based on modified locally-weighted affine
   * estimator from [Revaud2015] and Fast Global Smoother as post-processing filter.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ximgproc/include/opencv2/ximgproc/sparse_match_interpolator.hpp#L77
   */
  EdgeAwareInterpolator: AugmentedModule['ximgproc_EdgeAwareInterpolator']
/**
   * Sparse match interpolation algorithm based on modified piecewise locally-weighted affine
   * estimator called Robust Interpolation method of Correspondences or RIC from [Hu2017] and Variational
   * and Fast Global Smoother as post-processing filter. The RICInterpolator is a extension of the EdgeAwareInterpolator.
   * Main concept of this extension is an piece-wise affine model based on over-segmentation via SLIC superpixel estimation.
   * The method contains an efficient propagation mechanism to estimate among the pieces-wise models.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ximgproc/include/opencv2/ximgproc/sparse_match_interpolator.hpp#L146
   */
  RICInterpolator: AugmentedModule['ximgproc_RICInterpolator']
/**
   * Helper class for training part of [P. Dollar and C. L. Zitnick. Structured Forests for Fast Edge Detection, 2013].
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ximgproc/include/opencv2/ximgproc/structured_edge_detection.hpp#L65
   */
  RFFeatureGetter: AugmentedModule['ximgproc_RFFeatureGetter']
/**
   * Class implementing edge detection algorithm from [Dollar2013] :
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ximgproc/include/opencv2/ximgproc/structured_edge_detection.hpp#L97
   */
  StructuredEdgeDetection: AugmentedModule['ximgproc_StructuredEdgeDetection']
/**
   * Native enum entries for ximgproc thinning types. Pass an entry to enum-typed arguments or its .value to numeric arguments.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ximgproc/include/opencv2/ximgproc.hpp#L154
   */
  ThinningTypes: AugmentedModule['ximgproc_ThinningTypes']
/**
   * Specifies the binarization method to use in cv::ximgproc::niBlackThreshold
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ximgproc/include/opencv2/ximgproc.hpp#L162
   */
  LocalBinarizationMethods: AugmentedModule['ximgproc_LocalBinarizationMethods']
/**
   * Native enum entries for ximgproc edge drawing gradient operator. Pass an entry to enum-typed arguments or its .value to numeric arguments.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ximgproc/include/opencv2/ximgproc/edge_drawing.hpp#L25
   */
  EdgeDrawing_GradientOperator: AugmentedModule['ximgproc_EdgeDrawing_GradientOperator']
/**
   * Native enum entries for ximgproc edge aware filters list. Pass an entry to enum-typed arguments or its .value to numeric arguments.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ximgproc/include/opencv2/ximgproc/edge_filter.hpp#L51
   */
  EdgeAwareFiltersList: AugmentedModule['ximgproc_EdgeAwareFiltersList']
/**
   * Specifies the part of Hough space to calculate
   * The enum specifies the part of Hough space to calculate. Each
   * member specifies primarily direction of lines (horizontal or vertical)
   * and the direction of angle changes.
   * Direction of angle changes is from multiples of 90 to odd multiples of 45.
   * The image considered to be written top-down and left-to-right.
   * Angles are started from vertical line and go clockwise.
   * Separate quarters and halves are written in orientation they should be in
   * full Hough space.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ximgproc/include/opencv2/ximgproc/fast_hough_transform.hpp#L64
   */
  AngleRangeOption: AugmentedModule['ximgproc_AngleRangeOption']
/**
   * Specifies binary operations.
   * The enum specifies binary operations, that is such ones which involve
   *          two operands. Formally, a binary operation ` f ` on a set ` S `
   *          is a binary relation that maps elements of the Cartesian product
   *          ` S \times S ` to ` S `:
   *          
   * ```math
   *  f: S \times S \to S 
   * ```
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ximgproc/include/opencv2/ximgproc/fast_hough_transform.hpp#L87
   */
  HoughOp: AugmentedModule['ximgproc_HoughOp']
/**
   * Specifies to do or not to do skewing of Hough transform image
   * The enum specifies to do or not to do skewing of Hough transform image
   * so it would be no cycling in Hough transform image through borders of image.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ximgproc/include/opencv2/ximgproc/fast_hough_transform.hpp#L104
   */
  HoughDeskewOption: AugmentedModule['ximgproc_HoughDeskewOption']
/**
   * Native enum entries for ximgproc slictype. Pass an entry to enum-typed arguments or its .value to numeric arguments.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ximgproc/include/opencv2/ximgproc/slic.hpp#L64
   */
  SLICType: AugmentedModule['ximgproc_SLICType']
/**
   * Specifies weight types of weighted median filter.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ximgproc/include/opencv2/ximgproc/weighted_median_filter.hpp#L64
   */
  WMFWeightType: AugmentedModule['ximgproc_WMFWeightType']
/**
   * Thinning technique of Zhang-Suen
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ximgproc/include/opencv2/ximgproc.hpp#L155
   */
  THINNING_ZHANGSUEN: AugmentedModule['ximgproc_THINNING_ZHANGSUEN']
/**
   * Thinning technique of Guo-Hall
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ximgproc/include/opencv2/ximgproc.hpp#L156
   */
  THINNING_GUOHALL: AugmentedModule['ximgproc_THINNING_GUOHALL']
/**
   * Classic Niblack binarization. See [Niblack1985] .
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ximgproc/include/opencv2/ximgproc.hpp#L163
   */
  BINARIZATION_NIBLACK: AugmentedModule['ximgproc_BINARIZATION_NIBLACK']
/**
   * Sauvola's technique. See [Sauvola1997] .
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ximgproc/include/opencv2/ximgproc.hpp#L164
   */
  BINARIZATION_SAUVOLA: AugmentedModule['ximgproc_BINARIZATION_SAUVOLA']
/**
   * Wolf's technique. See [Wolf2004] .
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ximgproc/include/opencv2/ximgproc.hpp#L165
   */
  BINARIZATION_WOLF: AugmentedModule['ximgproc_BINARIZATION_WOLF']
/**
   * NICK technique. See [Khurshid2009] .
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ximgproc/include/opencv2/ximgproc.hpp#L166
   */
  BINARIZATION_NICK: AugmentedModule['ximgproc_BINARIZATION_NICK']
/**
   * ximgproc edge drawing prewitt constant (0), defined by OpenCV for cv::ximgproc::EdgeDrawing.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ximgproc/include/opencv2/ximgproc/edge_drawing.hpp#L27
   */
  EdgeDrawing_PREWITT: AugmentedModule['ximgproc_EdgeDrawing_PREWITT']
/**
   * ximgproc edge drawing prewitt constant (0), defined by OpenCV for cv::ximgproc::EdgeDrawing.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ximgproc/include/opencv2/ximgproc/edge_drawing.hpp#L27
   */
  EDGE_DRAWING_PREWITT: AugmentedModule['ximgproc_EDGE_DRAWING_PREWITT']
/**
   * ximgproc edge drawing sobel constant (1), defined by OpenCV for cv::ximgproc::EdgeDrawing.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ximgproc/include/opencv2/ximgproc/edge_drawing.hpp#L28
   */
  EdgeDrawing_SOBEL: AugmentedModule['ximgproc_EdgeDrawing_SOBEL']
/**
   * ximgproc edge drawing sobel constant (1), defined by OpenCV for cv::ximgproc::EdgeDrawing.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ximgproc/include/opencv2/ximgproc/edge_drawing.hpp#L28
   */
  EDGE_DRAWING_SOBEL: AugmentedModule['ximgproc_EDGE_DRAWING_SOBEL']
/**
   * ximgproc edge drawing scharr constant (2), defined by OpenCV for cv::ximgproc::EdgeDrawing.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ximgproc/include/opencv2/ximgproc/edge_drawing.hpp#L29
   */
  EdgeDrawing_SCHARR: AugmentedModule['ximgproc_EdgeDrawing_SCHARR']
/**
   * ximgproc edge drawing scharr constant (2), defined by OpenCV for cv::ximgproc::EdgeDrawing.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ximgproc/include/opencv2/ximgproc/edge_drawing.hpp#L29
   */
  EDGE_DRAWING_SCHARR: AugmentedModule['ximgproc_EDGE_DRAWING_SCHARR']
/**
   * ximgproc edge drawing lsd constant (3), defined by OpenCV for cv::ximgproc::EdgeDrawing.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ximgproc/include/opencv2/ximgproc/edge_drawing.hpp#L30
   */
  EdgeDrawing_LSD: AugmentedModule['ximgproc_EdgeDrawing_LSD']
/**
   * ximgproc edge drawing lsd constant (3), defined by OpenCV for cv::ximgproc::EdgeDrawing.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ximgproc/include/opencv2/ximgproc/edge_drawing.hpp#L30
   */
  EDGE_DRAWING_LSD: AugmentedModule['ximgproc_EDGE_DRAWING_LSD']
/**
   * ximgproc dtf nc constant (0), defined by OpenCV for cv::ximgproc.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ximgproc/include/opencv2/ximgproc/edge_filter.hpp#L53
   */
  DTF_NC: AugmentedModule['ximgproc_DTF_NC']
/**
   * ximgproc dtf ic constant (1), defined by OpenCV for cv::ximgproc.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ximgproc/include/opencv2/ximgproc/edge_filter.hpp#L54
   */
  DTF_IC: AugmentedModule['ximgproc_DTF_IC']
/**
   * ximgproc dtf rf constant (2), defined by OpenCV for cv::ximgproc.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ximgproc/include/opencv2/ximgproc/edge_filter.hpp#L55
   */
  DTF_RF: AugmentedModule['ximgproc_DTF_RF']
/**
   * ximgproc guided filter constant (3), defined by OpenCV for cv::ximgproc.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ximgproc/include/opencv2/ximgproc/edge_filter.hpp#L57
   */
  GUIDED_FILTER: AugmentedModule['ximgproc_GUIDED_FILTER']
/**
   * ximgproc am filter constant (4), defined by OpenCV for cv::ximgproc.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ximgproc/include/opencv2/ximgproc/edge_filter.hpp#L58
   */
  AM_FILTER: AugmentedModule['ximgproc_AM_FILTER']
/**
   * Vertical primarily direction and clockwise angle changes
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ximgproc/include/opencv2/ximgproc/fast_hough_transform.hpp#L66
   */
  ARO_0_45: AugmentedModule['ximgproc_ARO_0_45']
/**
   * Horizontal primarily direction and counterclockwise angle changes
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ximgproc/include/opencv2/ximgproc/fast_hough_transform.hpp#L67
   */
  ARO_45_90: AugmentedModule['ximgproc_ARO_45_90']
/**
   * Horizontal primarily direction and clockwise angle changes
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ximgproc/include/opencv2/ximgproc/fast_hough_transform.hpp#L68
   */
  ARO_90_135: AugmentedModule['ximgproc_ARO_90_135']
/**
   * Vertical primarily direction and counterclockwise angle changes
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ximgproc/include/opencv2/ximgproc/fast_hough_transform.hpp#L69
   */
  ARO_315_0: AugmentedModule['ximgproc_ARO_315_0']
/**
   * Vertical primarily direction
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ximgproc/include/opencv2/ximgproc/fast_hough_transform.hpp#L70
   */
  ARO_315_45: AugmentedModule['ximgproc_ARO_315_45']
/**
   * Horizontal primarily direction
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ximgproc/include/opencv2/ximgproc/fast_hough_transform.hpp#L71
   */
  ARO_45_135: AugmentedModule['ximgproc_ARO_45_135']
/**
   * Full set of directions
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ximgproc/include/opencv2/ximgproc/fast_hough_transform.hpp#L72
   */
  ARO_315_135: AugmentedModule['ximgproc_ARO_315_135']
/**
   * 90 +/- atan(0.5), interval approximately from 64.5 to 116.5 degrees.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ximgproc/include/opencv2/ximgproc/fast_hough_transform.hpp#L73
   */
  ARO_CTR_HOR: AugmentedModule['ximgproc_ARO_CTR_HOR']
/**
   * +/- atan(0.5), interval approximately from 333.5(-26.5) to 26.5 degrees
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ximgproc/include/opencv2/ximgproc/fast_hough_transform.hpp#L75
   */
  ARO_CTR_VER: AugmentedModule['ximgproc_ARO_CTR_VER']
/**
   * Binary minimum operation. The constant specifies the binary minimum operation
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ximgproc/include/opencv2/ximgproc/fast_hough_transform.hpp#L89
   */
  FHT_MIN: AugmentedModule['ximgproc_FHT_MIN']
/**
   * Binary maximum operation. The constant specifies the binary maximum operation
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ximgproc/include/opencv2/ximgproc/fast_hough_transform.hpp#L91
   */
  FHT_MAX: AugmentedModule['ximgproc_FHT_MAX']
/**
   * Binary addition operation. The constant specifies the binary addition operation
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ximgproc/include/opencv2/ximgproc/fast_hough_transform.hpp#L93
   */
  FHT_ADD: AugmentedModule['ximgproc_FHT_ADD']
/**
   * Binary average operation. The constant specifies the binary average operation
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ximgproc/include/opencv2/ximgproc/fast_hough_transform.hpp#L95
   */
  FHT_AVE: AugmentedModule['ximgproc_FHT_AVE']
/**
   * Use raw cyclic image
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ximgproc/include/opencv2/ximgproc/fast_hough_transform.hpp#L106
   */
  HDO_RAW: AugmentedModule['ximgproc_HDO_RAW']
/**
   * Prepare deskewed image
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ximgproc/include/opencv2/ximgproc/fast_hough_transform.hpp#L107
   */
  HDO_DESKEW: AugmentedModule['ximgproc_HDO_DESKEW']
/**
   * ximgproc slic constant (100), defined by OpenCV for cv::ximgproc.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ximgproc/include/opencv2/ximgproc/slic.hpp#L64
   */
  SLIC: AugmentedModule['ximgproc_SLIC']
/**
   * ximgproc slico constant (101), defined by OpenCV for cv::ximgproc.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ximgproc/include/opencv2/ximgproc/slic.hpp#L64
   */
  SLICO: AugmentedModule['ximgproc_SLICO']
/**
   * ximgproc mslic constant (102), defined by OpenCV for cv::ximgproc.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ximgproc/include/opencv2/ximgproc/slic.hpp#L64
   */
  MSLIC: AugmentedModule['ximgproc_MSLIC']
/**
   * `exp(-|I1-I2|^2/(2*sigma^2))`
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ximgproc/include/opencv2/ximgproc/weighted_median_filter.hpp#L66
   */
  WMF_EXP: AugmentedModule['ximgproc_WMF_EXP']
/**
   * `(|I1-I2|+sigma)^-1`
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ximgproc/include/opencv2/ximgproc/weighted_median_filter.hpp#L67
   */
  WMF_IV1: AugmentedModule['ximgproc_WMF_IV1']
/**
   * `(|I1-I2|^2+sigma^2)^-1`
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ximgproc/include/opencv2/ximgproc/weighted_median_filter.hpp#L68
   */
  WMF_IV2: AugmentedModule['ximgproc_WMF_IV2']
/**
   * `dot(I1,I2)/(|I1|*|I2|)`
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ximgproc/include/opencv2/ximgproc/weighted_median_filter.hpp#L69
   */
  WMF_COS: AugmentedModule['ximgproc_WMF_COS']
/**
   * `(min(r1,r2)+min(g1,g2)+min(b1,b2))/(max(r1,r2)+max(g1,g2)+max(b1,b2))`
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ximgproc/include/opencv2/ximgproc/weighted_median_filter.hpp#L70
   */
  WMF_JAC: AugmentedModule['ximgproc_WMF_JAC']
/**
   * ximgproc_WMF_OFF: unweighted
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ximgproc/include/opencv2/ximgproc/weighted_median_filter.hpp#L71
   */
  WMF_OFF: AugmentedModule['ximgproc_WMF_OFF']
  /** Native ximgproc.segmentation namespace. */
  segmentation: CVNamespace<'ximgproc_segmentation'> & {
/**
   * Graph Based Segmentation Algorithm.
   *                         The class implements the algorithm described in [PFF2004] .
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ximgproc/include/opencv2/ximgproc/segmentation.hpp#L46
   */
  GraphSegmentation: AugmentedModule['ximgproc_segmentation_GraphSegmentation']
/**
   * Strategie for the selective search segmentation algorithm
   *                         The class implements a generic stragery for the algorithm described in [uijlings2013selective].
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ximgproc/include/opencv2/ximgproc/segmentation.hpp#L74
   */
  SelectiveSearchSegmentationStrategy: AugmentedModule['ximgproc_segmentation_SelectiveSearchSegmentationStrategy']
/**
   * Color-based strategy for the selective search segmentation algorithm
   *                         The class is implemented from the algorithm described in [uijlings2013selective].
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ximgproc/include/opencv2/ximgproc/segmentation.hpp#L100
   */
  SelectiveSearchSegmentationStrategyColor: AugmentedModule['ximgproc_segmentation_SelectiveSearchSegmentationStrategyColor']
/**
   * Size-based strategy for the selective search segmentation algorithm
   *                         The class is implemented from the algorithm described in [uijlings2013selective].
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ximgproc/include/opencv2/ximgproc/segmentation.hpp#L109
   */
  SelectiveSearchSegmentationStrategySize: AugmentedModule['ximgproc_segmentation_SelectiveSearchSegmentationStrategySize']
/**
   * Texture-based strategy for the selective search segmentation algorithm
   *                         The class is implemented from the algorithm described in [uijlings2013selective].
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ximgproc/include/opencv2/ximgproc/segmentation.hpp#L118
   */
  SelectiveSearchSegmentationStrategyTexture: AugmentedModule['ximgproc_segmentation_SelectiveSearchSegmentationStrategyTexture']
/**
   * Fill-based strategy for the selective search segmentation algorithm
   *                         The class is implemented from the algorithm described in [uijlings2013selective].
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ximgproc/include/opencv2/ximgproc/segmentation.hpp#L127
   */
  SelectiveSearchSegmentationStrategyFill: AugmentedModule['ximgproc_segmentation_SelectiveSearchSegmentationStrategyFill']
/**
   * Regroup multiple strategies for the selective search segmentation algorithm
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ximgproc/include/opencv2/ximgproc/segmentation.hpp#L135
   */
  SelectiveSearchSegmentationStrategyMultiple: AugmentedModule['ximgproc_segmentation_SelectiveSearchSegmentationStrategyMultiple']
/**
   * Selective search segmentation algorithm
   *                         The class implements the algorithm described in [uijlings2013selective].
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/ximgproc/include/opencv2/ximgproc/segmentation.hpp#L181
   */
  SelectiveSearchSegmentation: AugmentedModule['ximgproc_segmentation_SelectiveSearchSegmentation']
}
}
  /** Native xphoto namespace. */
  xphoto: CVNamespace<'xphoto'> & {
/**
   * This algorithm decomposes image into two layers: base layer and detail layer using bilateral filter
   * and compresses contrast of the base layer thus preserving all the details.
   *
   * This implementation uses regular bilateral filter from OpenCV.
   *
   * Saturation enhancement is possible as in cv::TonemapDrago.
   *
   * For more information see [DD02] .
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xphoto/include/opencv2/xphoto/tonemap.hpp#L24
   */
  TonemapDurand: AugmentedModule['xphoto_TonemapDurand']
/**
   * The base class for auto white balance algorithms.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xphoto/include/opencv2/xphoto/white_balance.hpp#L63
   */
  WhiteBalancer: AugmentedModule['xphoto_WhiteBalancer']
/**
   * A simple white balance algorithm that works by independently stretching
   *     each of the input image channels to the specified range. For increased robustness
   *     it ignores the top and bottom `p\%` of pixel values.
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xphoto/include/opencv2/xphoto/white_balance.hpp#L79
   */
  SimpleWB: AugmentedModule['xphoto_SimpleWB']
/**
   * Gray-world white balance algorithm
   *
   * This algorithm scales the values of pixels based on a
   * gray-world assumption which states that the average of all channels
   * should result in a gray image.
   *
   * It adds a modification which thresholds pixels based on their
   * saturation value and only uses pixels below the provided threshold in
   * finding average pixel values.
   *
   * Saturation is calculated using the following for a 3-channel RGB image per
   * pixel I and is in the range [0, 1]:
   *
   * ```math
   *  \texttt{Saturation} [I] = \frac{\textrm{max}(R,G,B) - \textrm{min}(R,G,B)
   * }{\textrm{max}(R,G,B)} 
   * ```
   *
   * A threshold of 1 means that all pixels are used to white-balance, while a
   * threshold of 0 means no pixels are used. Lower thresholds are useful in
   * white-balancing saturated images.
   *
   * Currently supports images of type `CV_8UC3` and `CV_16UC3.`
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xphoto/include/opencv2/xphoto/white_balance.hpp#L139
   */
  GrayworldWB: AugmentedModule['xphoto_GrayworldWB']
/**
   * More sophisticated learning-based automatic white balance algorithm.
   *
   * As `GrayworldWB`, this algorithm works by applying different gains to the input
   * image channels, but their computation is a bit more involved compared to the
   * simple gray-world assumption. More details about the algorithm can be found in
   * [Cheng2015] .
   *
   * To mask out saturated pixels this function uses only pixels that satisfy the
   * following condition:
   *
   * ```math
   *  \frac{\textrm{max}(R,G,B)}{\texttt{range_max_val}} < \texttt{saturation_thresh} 
   * ```
   *
   * Currently supports images of type `CV_8UC3` and `CV_16UC3.`
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xphoto/include/opencv2/xphoto/white_balance.hpp#L168
   */
  LearningBasedWB: AugmentedModule['xphoto_LearningBasedWB']
/**
   * BM3D transform types
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xphoto/include/opencv2/xphoto/bm3d_image_denoising.hpp#L61
   */
  TransformTypes: AugmentedModule['xphoto_TransformTypes']
/**
   * BM3D algorithm steps
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xphoto/include/opencv2/xphoto/bm3d_image_denoising.hpp#L68
   */
  Bm3dSteps: AugmentedModule['xphoto_Bm3dSteps']
/**
   * Various inpainting algorithms
   * See: inpaint
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xphoto/include/opencv2/xphoto/inpainting.hpp#L69
   */
  InpaintTypes: AugmentedModule['xphoto_InpaintTypes']
/**
   * Un-normalized Haar transform
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xphoto/include/opencv2/xphoto/bm3d_image_denoising.hpp#L64
   */
  HAAR: AugmentedModule['xphoto_HAAR']
/**
   * Execute all steps of the algorithm
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xphoto/include/opencv2/xphoto/bm3d_image_denoising.hpp#L71
   */
  BM3D_STEPALL: AugmentedModule['xphoto_BM3D_STEPALL']
/**
   * Execute only first step of the algorithm
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xphoto/include/opencv2/xphoto/bm3d_image_denoising.hpp#L73
   */
  BM3D_STEP1: AugmentedModule['xphoto_BM3D_STEP1']
/**
   * Execute only second step of the algorithm
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xphoto/include/opencv2/xphoto/bm3d_image_denoising.hpp#L75
   */
  BM3D_STEP2: AugmentedModule['xphoto_BM3D_STEP2']
/**
   * This algorithm searches for dominant correspondences (transformations) of
   *         image patches and tries to seamlessly fill-in the area to be inpainted using this
   *         transformations
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xphoto/include/opencv2/xphoto/inpainting.hpp#L74
   */
  INPAINT_SHIFTMAP: AugmentedModule['xphoto_INPAINT_SHIFTMAP']
/**
   * See #INPAINT_FSR_BEST
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xphoto/include/opencv2/xphoto/inpainting.hpp#L95
   */
  INPAINT_FSR_BEST: AugmentedModule['xphoto_INPAINT_FSR_BEST']
/**
   * See #INPAINT_FSR_BEST
   *
   * @see https://github.com/opencv/opencv_contrib/blob/5.0.0/modules/xphoto/include/opencv2/xphoto/inpainting.hpp#L95
   */
  INPAINT_FSR_FAST: AugmentedModule['xphoto_INPAINT_FSR_FAST']
}
}
export declare const namespacePaths: readonly string[]
export declare const classBases: Readonly<Record<string, string>>
export declare const nestedClasses: readonly { native: string, parent: string, name: string }[]
